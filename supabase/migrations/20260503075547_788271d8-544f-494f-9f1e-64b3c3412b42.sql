
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease_v2(p_runner_id text, p_track text DEFAULT NULL::text, p_lease_seconds integer DEFAULT 600)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_package_id uuid;
  v_max_slots int;
  v_active_leases int;
  v_wip_limit int;
  v_building_count_global int;
  v_rebuild_count int;
  v_effective_wip int;
  v_raw_val text;
  v_unblocked int;
  v_orphan_reclaimed int;
  v_orphan_protected_skipped int;
  v_bonus_slots int;
  v_bonus_threshold int;
  v_bonus_eligible int;
  v_recent_skip_log timestamptz;
BEGIN
  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key='max_concurrent_packages';
    v_max_slots := nullif(v_raw_val,'')::int;
  EXCEPTION WHEN OTHERS THEN v_max_slots := NULL; END;
  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key='wip_limit';
    v_wip_limit := nullif(v_raw_val,'')::int;
  EXCEPTION WHEN OTHERS THEN v_wip_limit := NULL; END;
  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key='wip_bonus_slots';
    v_bonus_slots := COALESCE(nullif(v_raw_val,'')::int, 4);
  EXCEPTION WHEN OTHERS THEN v_bonus_slots := 4; END;
  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key='wip_bonus_progress_threshold';
    v_bonus_threshold := COALESCE(nullif(v_raw_val,'')::int, 50);
  EXCEPTION WHEN OTHERS THEN v_bonus_threshold := 50; END;

  v_max_slots := COALESCE(v_max_slots, 3);
  v_wip_limit := COALESCE(v_wip_limit, 1);

  DELETE FROM public.package_leases WHERE lease_until < now();

  SELECT count(*) INTO v_active_leases FROM public.package_leases WHERE lease_until > now();
  IF v_active_leases >= v_max_slots THEN RETURN NULL; END IF;

  -- ORPHAN RECLAIM (Protection-aware, SAFE_PACKAGE_STATUS_DEMOTE)
  WITH candidates AS (
    SELECT cp.id
    FROM public.course_packages cp
    WHERE cp.status='building'
      AND (p_track IS NULL OR cp.track::text = p_track)
      AND NOT EXISTS (SELECT 1 FROM public.package_leases pl WHERE pl.package_id = cp.id)
      AND NOT EXISTS (SELECT 1 FROM public.job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('pending','processing'))
      AND NOT EXISTS (SELECT 1 FROM public.package_steps ps WHERE ps.package_id = cp.id AND ps.status IN ('running','enqueued','queued'))
  ),
  filtered AS (
    SELECT c.id, (public.fn_package_demote_protected(c.id)->>'protected')::boolean AS is_protected
    FROM candidates c
  ),
  did_update AS (
    UPDATE public.course_packages cp
       SET status='queued', updated_at=now()
     WHERE cp.id IN (SELECT id FROM filtered WHERE is_protected = false)
    RETURNING cp.id
  )
  SELECT
    (SELECT count(*) FROM did_update),
    (SELECT count(*) FROM filtered WHERE is_protected = true)
  INTO v_orphan_reclaimed, v_orphan_protected_skipped;

  -- Throttle: max 1 Skip-Log pro 15 Min (Anti-Noise)
  IF COALESCE(v_orphan_protected_skipped, 0) > 0 THEN
    SELECT MAX(created_at) INTO v_recent_skip_log
    FROM public.auto_heal_log
    WHERE action_type='orphan_reclaim_protected_skip'
      AND created_at > now() - interval '15 minutes';

    IF v_recent_skip_log IS NULL THEN
      BEGIN
        INSERT INTO public.auto_heal_log
          (trigger_source, action_type, target_type, result_status, result_detail, metadata)
        VALUES (
          'acquire_v2', 'orphan_reclaim_protected_skip', 'system', 'skipped',
          format('Skipped %s protected packages (15min throttled)', v_orphan_protected_skipped),
          jsonb_build_object('skipped', v_orphan_protected_skipped, 'runner_id', p_runner_id, 'track', p_track, 'throttle', '15m')
        );
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;

  IF COALESCE(v_orphan_reclaimed, 0) > 0 THEN
    RAISE LOG '[acquire_v2] Reclaimed % true orphan building packages (protected skipped: %)',
              v_orphan_reclaimed, COALESCE(v_orphan_protected_skipped, 0);
  END IF;

  SELECT count(*) INTO v_rebuild_count FROM public.course_packages WHERE status='building' AND is_rebuild=true;
  SELECT count(*) INTO v_building_count_global FROM public.course_packages WHERE status='building';
  SELECT count(*) INTO v_bonus_eligible FROM public.course_packages
   WHERE status='building' AND build_progress >= v_bonus_threshold;

  v_effective_wip := v_wip_limit + v_rebuild_count + LEAST(v_bonus_eligible, v_bonus_slots);

  IF v_building_count_global >= v_effective_wip THEN
    BEGIN
      INSERT INTO auto_heal_log (trigger_source, action_type, result_status, result_detail, metadata)
      VALUES ('acquire_v2','wip_admission_blocked','blocked',
        format('Global WIP %s >= cap %s (base=%s, bonus=%s). Runner=%s, track=%s',
          v_building_count_global, v_effective_wip, v_wip_limit, LEAST(v_bonus_eligible, v_bonus_slots), p_runner_id, COALESCE(p_track,'any')),
        jsonb_build_object('building_count',v_building_count_global,'effective_wip',v_effective_wip,
          'bonus_eligible',v_bonus_eligible,'runner_id',p_runner_id,'track',p_track));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN NULL;
  END IF;

  WITH to_unblock AS (
    SELECT id FROM public.course_packages
    WHERE status='blocked'
      AND (p_track IS NULL OR track::text = p_track)
      AND (blocked_reason IS NULL OR blocked_reason='')
    LIMIT 5
  )
  UPDATE public.course_packages SET status='queued', blocked_reason=NULL, updated_at=now()
  WHERE id IN (SELECT id FROM to_unblock);

  PERFORM set_config('app.transition_source','acquire_next_package_lease_v2', true);

  SELECT cp.id INTO v_package_id
  FROM public.course_packages cp
  WHERE cp.status='queued'
    AND (p_track IS NULL OR cp.track::text = p_track)
  ORDER BY COALESCE(cp.priority, 100) ASC, cp.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_package_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.course_packages SET status='building', updated_at=now() WHERE id = v_package_id;

  INSERT INTO public.package_leases (package_id, runner_id, lease_until)
  VALUES (v_package_id, p_runner_id, now() + make_interval(secs => p_lease_seconds))
  ON CONFLICT (package_id) DO UPDATE
    SET runner_id = EXCLUDED.runner_id, lease_until = EXCLUDED.lease_until;

  RETURN v_package_id;
END;
$function$;
