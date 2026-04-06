
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease_v2(
  p_runner_id text,
  p_lease_seconds int DEFAULT 120,
  p_track text DEFAULT NULL
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
BEGIN
  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages';
    v_max_slots := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_max_slots := NULL; END;

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'wip_limit';
    v_wip_limit := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_wip_limit := NULL; END;

  v_max_slots := COALESCE(v_max_slots, 3);
  v_wip_limit := COALESCE(v_wip_limit, 1);

  DELETE FROM public.package_leases WHERE lease_until < now();

  SELECT count(*) INTO v_active_leases FROM public.package_leases WHERE lease_until > now();
  IF v_active_leases >= v_max_slots THEN RETURN NULL; END IF;

  -- ORPHAN RECLAIM: only packages with NO queued steps (truly done/stuck)
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
  v_effective_wip := v_wip_limit + v_rebuild_count;

  -- ADMISSION GATE
  IF v_building_count_global >= v_effective_wip THEN
    BEGIN
      INSERT INTO auto_heal_log (trigger_source, action_type, result_status, result_detail, metadata)
      VALUES ('acquire_v2', 'wip_admission_blocked', 'blocked',
        format('Global WIP %s >= cap %s. Runner=%s, track=%s', v_building_count_global, v_effective_wip, p_runner_id, COALESCE(p_track, 'any')),
        jsonb_build_object('building_count', v_building_count_global, 'effective_wip', v_effective_wip, 'runner_id', p_runner_id, 'track', p_track));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN NULL;
  END IF;

  -- UNBLOCK (using subquery instead of LIMIT)
  WITH to_unblock AS (
    SELECT id FROM public.course_packages
    WHERE status = 'blocked'
      AND (p_track IS NULL OR track::text = p_track)
      AND (blocked_reason IS NULL OR blocked_reason = '')
    LIMIT 5
  )
  UPDATE public.course_packages SET status = 'queued', blocked_reason = NULL, updated_at = now()
  WHERE id IN (SELECT id FROM to_unblock);

  -- ══════════════════════════════════════════════════════════
  -- STRICT PRIORITY GATE: Only acquire packages at the lowest
  -- active priority tier. Prio 2 CANNOT start while any Prio 1
  -- package is queued or building.
  -- ══════════════════════════════════════════════════════════
  SELECT MIN(priority) INTO v_min_incomplete_priority
  FROM public.course_packages
  WHERE status IN ('building', 'queued')
    AND (p_track IS NULL OR track::text = p_track);

  -- Strict: only allow exact same priority tier (no additive offset)
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
      AND NOT EXISTS (SELECT 1 FROM public.package_leases pl WHERE pl.package_id = course_packages.id)
    ORDER BY priority ASC, updated_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_package_id IS NULL THEN RETURN NULL; END IF;

    -- Double-check WIP inside the lock
    SELECT count(*) INTO v_building_count_global FROM public.course_packages WHERE status = 'building';
    IF v_building_count_global >= v_effective_wip THEN RETURN NULL; END IF;

    UPDATE public.course_packages
    SET status = 'building', updated_at = now()
    WHERE id = v_package_id;

    INSERT INTO public.package_leases (package_id, runner_id, lease_until)
    VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
    ON CONFLICT (package_id) DO UPDATE SET runner_id = p_runner_id, lease_until = now() + (p_lease_seconds || ' seconds')::interval;

    RETURN v_package_id;
  END LOOP;
END;
$$;
