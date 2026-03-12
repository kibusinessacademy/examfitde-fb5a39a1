
-- STRUCTURAL FIX: acquire_next_package_lease_v2 must auto-unblock zombie-blocked packages
-- The deadlock occurs because:
--   1. Tier gating correctly includes 'blocked' in min_priority calculation
--   2. But the acquire SELECT only looks at 'queued' packages
--   3. If all packages at min_priority are 'blocked', nothing can ever be acquired
--
-- Fix: Before the acquire loop, auto-requeue blocked packages that have
-- blocked_reason = 'auto_heal_zombie' at the current min_priority tier.

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
  v_building_count int;
  v_rebuild_count int;
  v_effective_wip int;
  v_effective_status text;
  v_raw_val text;
  v_attempt int := 0;
  v_max_attempts int := 8;
  v_top_building_id uuid;
  v_min_incomplete_priority int;
  v_unblocked int;
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

  -- ── Defaults ──
  v_max_slots := COALESCE(v_max_slots, 3);
  v_wip_limit := COALESCE(v_wip_limit, 1);

  DELETE FROM public.package_leases WHERE lease_until < now();

  SELECT count(*) INTO v_active_leases FROM public.package_leases WHERE lease_until > now();
  IF v_active_leases >= v_max_slots THEN RETURN NULL; END IF;

  -- ══════════════════════════════════════════════════════════════
  -- REBUILD WIP BOOST: Rebuild packages get a SEPARATE slot
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
  -- HARD WIP RECONCILIATION (rebuild-aware)
  -- ══════════════════════════════════════════════════════════════
  IF v_building_count > v_effective_wip THEN
    SELECT id INTO v_top_building_id
    FROM public.course_packages
    WHERE status = 'building'
      AND is_rebuild = false
      AND (p_track IS NULL OR track::text = p_track)
    ORDER BY
      COALESCE(priority, 999999) ASC,
      build_progress DESC,
      updated_at ASC
    LIMIT 1;

    UPDATE public.course_packages
    SET status = 'queued', updated_at = now()
    WHERE status = 'building'
      AND is_rebuild = false
      AND (p_track IS NULL OR track::text = p_track)
      AND id != v_top_building_id;

    UPDATE public.job_queue jq
    SET status = 'cancelled',
        last_error = 'WIP hard reconciliation: package demoted'
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
  -- STRICT PRIORITY TIER GATING (includes 'blocked')
  -- ══════════════════════════════════════════════════════════════
  SELECT MIN(COALESCE(cp.priority, 999999))
  INTO v_min_incomplete_priority
  FROM public.course_packages cp
  WHERE cp.status IN ('queued', 'building', 'failed', 'setup_complete', 'blocked')
    AND cp.priority IS NOT NULL;

  v_min_incomplete_priority := COALESCE(v_min_incomplete_priority, 999999);

  -- ══════════════════════════════════════════════════════════════
  -- AUTO-UNBLOCK: Requeue zombie-blocked packages at min priority
  -- This prevents the deadlock where blocked packages at tier N
  -- prevent all tier N+1 packages from being acquired.
  -- ══════════════════════════════════════════════════════════════
  UPDATE public.course_packages
  SET status = 'queued',
      blocked_reason = NULL,
      updated_at = now()
  WHERE status = 'blocked'
    AND blocked_reason = 'auto_heal_zombie'
    AND COALESCE(priority, 999999) <= v_min_incomplete_priority
    AND (p_track IS NULL OR track::text = p_track);

  GET DIAGNOSTICS v_unblocked = ROW_COUNT;
  IF v_unblocked > 0 THEN
    RAISE LOG '[acquire_v2] Auto-unblocked % zombie packages at priority %', v_unblocked, v_min_incomplete_priority;
  END IF;

  IF v_building_count >= v_effective_wip THEN RETURN NULL; END IF;

  -- ── Acquire: try to find and lock a queued package ──
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

    -- Transition to building
    UPDATE public.course_packages
    SET status = 'building', updated_at = now()
    WHERE id = v_package_id AND status = 'queued';

    GET DIAGNOSTICS v_attempt = ROW_COUNT;
    IF v_attempt = 0 THEN CONTINUE; END IF;

    -- Create lease
    INSERT INTO public.package_leases (package_id, runner_id, lease_until)
    VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
    ON CONFLICT (package_id) DO UPDATE
    SET runner_id = EXCLUDED.runner_id, lease_until = EXCLUDED.lease_until, acquired_at = now();

    RETURN v_package_id;
  END LOOP;
END;
$$;
