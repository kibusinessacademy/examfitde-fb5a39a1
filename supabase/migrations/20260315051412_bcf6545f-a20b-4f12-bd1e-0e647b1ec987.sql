
-- FIX: Priority Tier Gate Deadlock
-- 'blocked' packages must NOT count as "incomplete" for tier gating
-- because they are terminal until manual intervention.
-- This was causing a complete pipeline deadlock: 5 blocked prio-1 packages
-- prevented ALL 307 queued packages from being acquired.

CREATE OR REPLACE FUNCTION public.acquire_next_package_lease_v2(
  p_runner_id text,
  p_lease_seconds int DEFAULT 120,
  p_track text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_package_id uuid;
  v_max_slots int;
  v_active_leases int;
  v_wip_limit int;
  v_building_count int;
  v_rebuild_count int;
  v_effective_wip int;
  v_raw_val text;
  v_attempt int := 0;
  v_max_attempts int := 8;
  v_top_building_id uuid;
  v_min_incomplete_priority int;
  v_unblocked int;
  v_orphan_reclaimed int;
BEGIN
  -- ── Read config ──
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

  -- ══════════════════════════════════════════════════════════════
  -- ORPHAN RECLAIM
  -- ══════════════════════════════════════════════════════════════
  UPDATE public.course_packages cp
  SET status = 'queued', updated_at = now()
  WHERE cp.status = 'building'
    AND (p_track IS NULL OR cp.track::text = p_track)
    AND NOT EXISTS (
      SELECT 1 FROM public.package_leases pl WHERE pl.package_id = cp.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.payload->>'package_id' = cp.id::text
        AND jq.status IN ('pending', 'processing')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.package_steps ps
      WHERE ps.package_id = cp.id
        AND ps.status IN ('running', 'enqueued')
    );

  GET DIAGNOSTICS v_orphan_reclaimed = ROW_COUNT;
  IF v_orphan_reclaimed > 0 THEN
    RAISE LOG '[acquire_v2] Reclaimed % orphan building packages', v_orphan_reclaimed;
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- REBUILD WIP BOOST
  -- ══════════════════════════════════════════════════════════════
  SELECT count(*) INTO v_rebuild_count
  FROM public.course_packages
  WHERE status = 'building' AND is_rebuild = true;

  IF p_track IS NULL THEN
    SELECT count(*) INTO v_building_count FROM public.course_packages WHERE status = 'building';
  ELSE
    SELECT count(*) INTO v_building_count FROM public.course_packages WHERE status = 'building' AND track::text = p_track;
  END IF;

  v_effective_wip := v_wip_limit + v_rebuild_count;

  -- ══════════════════════════════════════════════════════════════
  -- HARD WIP RECONCILIATION
  -- ══════════════════════════════════════════════════════════════
  IF v_building_count > v_effective_wip THEN
    SELECT id INTO v_top_building_id
    FROM public.course_packages
    WHERE status = 'building'
      AND is_rebuild = false
      AND (p_track IS NULL OR track::text = p_track)
    ORDER BY COALESCE(priority, 999999) ASC, build_progress DESC, updated_at ASC
    LIMIT 1;

    UPDATE public.course_packages
    SET status = 'queued', updated_at = now()
    WHERE status = 'building'
      AND is_rebuild = false
      AND (p_track IS NULL OR track::text = p_track)
      AND id != v_top_building_id;

    UPDATE public.job_queue jq
    SET status = 'cancelled', last_error = 'WIP hard reconciliation: package demoted'
    FROM public.course_packages cp
    WHERE cp.status = 'queued'
      AND cp.updated_at > now() - interval '5 seconds'
      AND jq.payload->>'package_id' = cp.id::text
      AND jq.status IN ('pending', 'processing');

    IF p_track IS NULL THEN
      SELECT count(*) INTO v_building_count FROM public.course_packages WHERE status = 'building';
    ELSE
      SELECT count(*) INTO v_building_count FROM public.course_packages WHERE status = 'building' AND track::text = p_track;
    END IF;
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- STRICT PRIORITY TIER GATING
  -- FIX: 'blocked' is EXCLUDED from tier calculation.
  -- Blocked packages are terminal until manual intervention and
  -- must NOT prevent lower-priority packages from starting.
  -- ══════════════════════════════════════════════════════════════
  SELECT MIN(COALESCE(cp.priority, 999999))
  INTO v_min_incomplete_priority
  FROM public.course_packages cp
  WHERE cp.status IN ('queued', 'building', 'failed', 'setup_complete')
    AND cp.priority IS NOT NULL;

  v_min_incomplete_priority := COALESCE(v_min_incomplete_priority, 999999);

  -- ══════════════════════════════════════════════════════════════
  -- AUTO-UNBLOCK: Requeue zombie-blocked packages at min priority
  -- ══════════════════════════════════════════════════════════════
  UPDATE public.course_packages
  SET status = 'queued', blocked_reason = NULL, updated_at = now()
  WHERE status = 'blocked'
    AND blocked_reason = 'auto_heal_zombie'
    AND COALESCE(priority, 999999) <= v_min_incomplete_priority
    AND (p_track IS NULL OR track::text = p_track);

  GET DIAGNOSTICS v_unblocked = ROW_COUNT;
  IF v_unblocked > 0 THEN
    RAISE LOG '[acquire_v2] Auto-unblocked % zombie packages at priority %', v_unblocked, v_min_incomplete_priority;
  END IF;

  IF v_building_count >= v_effective_wip THEN RETURN NULL; END IF;

  -- ── Acquire: find and lock a queued package ──
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > v_max_attempts THEN RETURN NULL; END IF;

    SELECT cp.id INTO v_package_id
    FROM public.course_packages cp
    WHERE cp.status = 'queued'
      AND (cp.blocked_reason IS NULL OR cp.blocked_reason = '')
      AND (p_track IS NULL OR cp.track::text = p_track)
      AND (cp.is_rebuild = true OR COALESCE(cp.priority, 999999) <= v_min_incomplete_priority)
      AND NOT EXISTS (
        SELECT 1 FROM public.package_leases pl
        WHERE pl.package_id = cp.id AND pl.lease_until > now()
      )
    ORDER BY
      cp.is_rebuild DESC,
      COALESCE(cp.priority, 999999) ASC,
      cp.updated_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_package_id IS NULL THEN RETURN NULL; END IF;

    UPDATE public.course_packages
    SET status = 'building', updated_at = now()
    WHERE id = v_package_id AND status = 'queued';

    GET DIAGNOSTICS v_attempt = ROW_COUNT;
    IF v_attempt = 0 THEN CONTINUE; END IF;

    INSERT INTO public.package_leases (package_id, runner_id, lease_until)
    VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
    ON CONFLICT (package_id) DO UPDATE
    SET runner_id = EXCLUDED.runner_id, lease_until = EXCLUDED.lease_until, acquired_at = now();

    RETURN v_package_id;
  END LOOP;
END;
$$;
