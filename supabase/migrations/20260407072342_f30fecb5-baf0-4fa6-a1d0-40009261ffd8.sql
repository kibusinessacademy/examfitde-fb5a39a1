
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease_v2(
    p_runner_id text,
    p_track text DEFAULT NULL,
    p_lease_seconds int DEFAULT 600
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package_id uuid;
  v_max_slots int;
  v_active_leases int;
  v_wip_limit int;
  v_building_count_global int;
  v_rebuild_count int;
  v_effective_wip int;
  v_raw_val text;
  v_attempt int := 0;
  v_max_attempts int := 8;
  v_min_incomplete_priority int;
  v_allowed_priority int;
  v_unblocked int;
  v_orphan_reclaimed int;
  v_bonus_slots int;
  v_bonus_threshold int;
  v_bonus_eligible int;
BEGIN
  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages';
    v_max_slots := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_max_slots := NULL; END;

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'wip_limit';
    v_wip_limit := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_wip_limit := NULL; END;

  -- Bonus WIP config
  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'wip_bonus_slots';
    v_bonus_slots := COALESCE(nullif(v_raw_val, '')::int, 4);
  EXCEPTION WHEN OTHERS THEN v_bonus_slots := 4; END;

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'wip_bonus_progress_threshold';
    v_bonus_threshold := COALESCE(nullif(v_raw_val, '')::int, 50);
  EXCEPTION WHEN OTHERS THEN v_bonus_threshold := 50; END;

  v_max_slots := COALESCE(v_max_slots, 3);
  v_wip_limit := COALESCE(v_wip_limit, 1);

  DELETE FROM public.package_leases WHERE lease_until < now();

  SELECT count(*) INTO v_active_leases FROM public.package_leases WHERE lease_until > now();
  IF v_active_leases >= v_max_slots THEN RETURN NULL; END IF;

  -- ORPHAN RECLAIM
  UPDATE public.course_packages cp
  SET status = 'queued', updated_at = now()
  WHERE cp.status = 'building'
    AND (p_track IS NULL OR cp.track::text = p_track)
    AND NOT EXISTS (SELECT 1 FROM public.package_leases pl WHERE pl.package_id = cp.id)
    AND NOT EXISTS (SELECT 1 FROM public.job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('pending', 'processing'))
    AND NOT EXISTS (SELECT 1 FROM public.package_steps ps WHERE ps.package_id = cp.id AND ps.status IN ('running', 'enqueued'))
    AND NOT EXISTS (SELECT 1 FROM public.package_steps ps WHERE ps.package_id = cp.id AND ps.status = 'queued');

  GET DIAGNOSTICS v_orphan_reclaimed = ROW_COUNT;
  IF v_orphan_reclaimed > 0 THEN
    RAISE LOG '[acquire_v2] Reclaimed % true orphan building packages (no queued steps)', v_orphan_reclaimed;
  END IF;

  SELECT count(*) INTO v_rebuild_count FROM public.course_packages WHERE status = 'building' AND is_rebuild = true;
  SELECT count(*) INTO v_building_count_global FROM public.course_packages WHERE status = 'building';
  
  -- Count bonus-eligible building packages (>threshold progress)
  SELECT count(*) INTO v_bonus_eligible FROM public.course_packages 
  WHERE status = 'building' AND build_progress >= v_bonus_threshold;

  -- Effective WIP = base + rebuilds + min(bonus_eligible, bonus_slots)
  v_effective_wip := v_wip_limit + v_rebuild_count + LEAST(v_bonus_eligible, v_bonus_slots);

  -- ADMISSION GATE
  IF v_building_count_global >= v_effective_wip THEN
    BEGIN
      INSERT INTO auto_heal_log (trigger_source, action_type, result_status, result_detail, metadata)
      VALUES ('acquire_v2', 'wip_admission_blocked', 'blocked',
        format('Global WIP %s >= cap %s (base=%s, bonus=%s). Runner=%s, track=%s', 
          v_building_count_global, v_effective_wip, v_wip_limit, LEAST(v_bonus_eligible, v_bonus_slots), p_runner_id, COALESCE(p_track, 'any')),
        jsonb_build_object('building_count', v_building_count_global, 'effective_wip', v_effective_wip, 
          'bonus_eligible', v_bonus_eligible, 'runner_id', p_runner_id, 'track', p_track));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN NULL;
  END IF;

  -- UNBLOCK
  WITH to_unblock AS (
    SELECT id FROM public.course_packages
    WHERE status = 'blocked'
      AND (p_track IS NULL OR track::text = p_track)
      AND (blocked_reason IS NULL OR blocked_reason = '')
    LIMIT 5
  )
  UPDATE public.course_packages SET status = 'queued', blocked_reason = NULL, updated_at = now()
  WHERE id IN (SELECT id FROM to_unblock);

  -- STRICT PRIORITY GATE
  SELECT MIN(priority) INTO v_min_incomplete_priority
  FROM public.course_packages
  WHERE status IN ('building', 'queued')
    AND (p_track IS NULL OR track::text = p_track);

  v_allowed_priority := COALESCE(v_min_incomplete_priority, 999);

  -- ACQUIRE LOOP
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > v_max_attempts THEN RETURN NULL; END IF;

    SELECT id INTO v_package_id
    FROM public.course_packages
    WHERE status = 'queued'
      AND (p_track IS NULL OR track::text = p_track)
      AND priority <= v_allowed_priority
    ORDER BY priority ASC, build_progress DESC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_package_id IS NULL THEN RETURN NULL; END IF;

    UPDATE public.course_packages SET status = 'building', updated_at = now()
    WHERE id = v_package_id;

    INSERT INTO public.package_leases (package_id, runner_id, lease_until)
    VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
    ON CONFLICT (package_id) DO UPDATE SET runner_id = p_runner_id, lease_until = now() + (p_lease_seconds || ' seconds')::interval;

    BEGIN
      INSERT INTO auto_heal_log (trigger_source, action_type, result_status, result_detail, metadata)
      VALUES ('acquire_v2', 'package_acquired', 'ok',
        format('Acquired %s by runner %s (wip=%s/%s)', v_package_id, p_runner_id, v_building_count_global+1, v_effective_wip),
        jsonb_build_object('package_id', v_package_id, 'runner_id', p_runner_id, 'wip', v_building_count_global+1, 'cap', v_effective_wip));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RETURN v_package_id;
  END LOOP;
END;
$$;
