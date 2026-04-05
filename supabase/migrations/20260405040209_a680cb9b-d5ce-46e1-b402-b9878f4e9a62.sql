
-- ═══════════════════════════════════════════════════════════════
-- FIX 1: acquire_next_package_lease_v2 — use GLOBAL building count for WIP cap
-- The per-track count was always under WIP cap (13), allowing unlimited promotions.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease_v2(
  p_runner_id text,
  p_lease_seconds integer DEFAULT 120,
  p_track text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_package_id uuid;
  v_max_slots int;
  v_active_leases int;
  v_wip_limit int;
  v_building_count int;
  v_building_count_global int;
  v_rebuild_count int;
  v_effective_wip int;
  v_raw_val text;
  v_attempt int := 0;
  v_max_attempts int := 8;
  v_top_building_id uuid;
  v_min_incomplete_priority int;
  v_allowed_priority int;
  v_unblocked int;
  v_orphan_reclaimed int;
  v_priority_gate int;
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

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'priority_gate_rank';
    v_priority_gate := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_priority_gate := NULL; END;

  v_max_slots := COALESCE(v_max_slots, 3);
  v_wip_limit := COALESCE(v_wip_limit, 1);
  v_priority_gate := COALESCE(v_priority_gate, 50);

  DELETE FROM public.package_leases WHERE lease_until < now();

  SELECT count(*) INTO v_active_leases FROM public.package_leases WHERE lease_until > now();
  IF v_active_leases >= v_max_slots THEN RETURN NULL; END IF;

  -- ══════════════════════════════════════════════════════════════
  -- ORPHAN RECLAIM (unchanged)
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

  -- ══════════════════════════════════════════════════════════════
  -- FIX: ALWAYS use GLOBAL building count for WIP cap check.
  -- The per-track count was the root cause of WIP overflow:
  -- each track had 2-4 building, far under cap 13, so the check
  -- never blocked — but combined they exceeded 13.
  -- ══════════════════════════════════════════════════════════════
  SELECT count(*) INTO v_building_count_global
  FROM public.course_packages WHERE status = 'building';

  -- Keep per-track count for logging only
  IF p_track IS NOT NULL THEN
    SELECT count(*) INTO v_building_count
    FROM public.course_packages WHERE status = 'building' AND track::text = p_track;
  ELSE
    v_building_count := v_building_count_global;
  END IF;

  v_effective_wip := v_wip_limit + v_rebuild_count;

  -- ══════════════════════════════════════════════════════════════
  -- REMOVED: HARD WIP RECONCILIATION
  -- The old code demoted ALL building packages except #1 when
  -- count exceeded cap. This caused cancel storms.
  -- Now we simply refuse to promote if cap is reached.
  -- Cleanup of genuine zombies is handled by orphan reclaim above
  -- and the watchdog's soft hygiene pass.
  -- ══════════════════════════════════════════════════════════════

  -- ══════════════════════════════════════════════════════════════
  -- RELAXED PRIORITY TIER GATING (unchanged)
  -- ══════════════════════════════════════════════════════════════
  SELECT MIN(COALESCE(cp.priority, 999999))
  INTO v_min_incomplete_priority
  FROM public.course_packages cp
  WHERE cp.status IN ('queued', 'building', 'failed', 'setup_complete')
    AND cp.priority IS NOT NULL;

  v_min_incomplete_priority := COALESCE(v_min_incomplete_priority, 999999);
  v_allowed_priority := GREATEST(v_min_incomplete_priority + 1, LEAST(v_priority_gate, v_min_incomplete_priority + 5));

  -- ══════════════════════════════════════════════════════════════
  -- AUTO-UNBLOCK (unchanged)
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

  -- ══════════════════════════════════════════════════════════════
  -- FIX: Use GLOBAL count for WIP gate (was using per-track before)
  -- ══════════════════════════════════════════════════════════════
  IF v_building_count_global >= v_effective_wip THEN RETURN NULL; END IF;

  -- ── Acquire: find and lock a queued package ──
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > v_max_attempts THEN RETURN NULL; END IF;

    SELECT cp.id INTO v_package_id
    FROM public.course_packages cp
    WHERE cp.status = 'queued'
      AND (cp.blocked_reason IS NULL OR cp.blocked_reason = '')
      AND (p_track IS NULL OR cp.track::text = p_track)
      AND (cp.is_rebuild = true OR COALESCE(cp.priority, 999999) <= v_allowed_priority)
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

    -- ── DOUBLE-CHECK: re-verify global WIP inside the lock ──
    SELECT count(*) INTO v_building_count_global
    FROM public.course_packages WHERE status = 'building';
    IF v_building_count_global >= v_effective_wip THEN
      RETURN NULL;
    END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.acquire_next_package_lease_v2(text, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.acquire_next_package_lease_v2(text, int, text) TO service_role;


-- ═══════════════════════════════════════════════════════════════
-- FIX 2: fn_reconcile_stale_qgf_packages — add WIP cap check
-- Previously promoted quality_gate_failed → building without
-- checking if WIP cap was already reached.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_reconcile_stale_qgf_packages()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  pkg record;
  v_promoted int := 0;
  v_skipped int := 0;
  v_wip_blocked int := 0;
  v_all_steps_done boolean;
  v_approved_q_count bigint;
  v_building_count int;
  v_wip_limit int;
  v_rebuild_count int;
  v_effective_wip int;
  v_raw_val text;
BEGIN
  -- ── Read WIP config ──
  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM ops_pipeline_config WHERE key = 'wip_limit';
    v_wip_limit := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_wip_limit := NULL; END;
  v_wip_limit := COALESCE(v_wip_limit, 13);

  SELECT count(*) INTO v_rebuild_count
  FROM course_packages WHERE status = 'building' AND is_rebuild = true;
  v_effective_wip := v_wip_limit + v_rebuild_count;

  FOR pkg IN
    SELECT cp.id, cp.curriculum_id, cp.integrity_passed, cp.council_approved,
           cp.integrity_report, cp.updated_at
    FROM course_packages cp
    WHERE cp.status = 'quality_gate_failed'
      AND cp.integrity_passed = true
      AND cp.council_approved = true
      AND cp.published_at IS NULL
    ORDER BY cp.priority ASC, cp.updated_at ASC
    LIMIT 5
  LOOP
    IF pkg.updated_at > now() - interval '2 minutes' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- ── WIP CAP CHECK: do not promote if cap reached ──
    SELECT count(*) INTO v_building_count
    FROM course_packages WHERE status = 'building';
    IF v_building_count >= v_effective_wip THEN
      v_wip_blocked := v_wip_blocked + 1;
      CONTINUE;
    END IF;

    SELECT NOT EXISTS (
      SELECT 1 FROM package_steps ps
      WHERE ps.package_id = pkg.id
        AND ps.step_key NOT IN ('auto_publish')
        AND ps.status NOT IN ('done', 'skipped')
    ) INTO v_all_steps_done;

    IF NOT v_all_steps_done THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF pkg.curriculum_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_approved_q_count
      FROM exam_questions
      WHERE curriculum_id = pkg.curriculum_id AND status = 'approved';
      IF v_approved_q_count < 40 THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    END IF;

    UPDATE course_packages
    SET status = 'building',
        blocked_reason = NULL,
        updated_at = now()
    WHERE id = pkg.id
      AND status = 'quality_gate_failed';

    UPDATE package_steps
    SET status = 'queued',
        started_at = NULL,
        finished_at = NULL,
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'qgf_reconcile_at', now()::text,
          'reconcile_reason', 'all_gates_green_auto_reentry'
        )
    WHERE package_id = pkg.id
      AND step_key = 'auto_publish'
      AND status NOT IN ('done', 'running', 'processing');

    INSERT INTO auto_heal_log (action_type, trigger_source, result_status, result_detail, target_id, target_type, metadata)
    VALUES ('QGF_RECONCILE_TO_BUILDING', 'fn_reconcile_stale_qgf_packages', 'success',
      'Promoted quality_gate_failed → building (all gates green, auto_publish pending)',
      pkg.id::text, 'course_package',
      jsonb_build_object(
        'integrity_passed', pkg.integrity_passed,
        'council_approved', pkg.council_approved,
        'approved_questions', v_approved_q_count
      ));

    v_promoted := v_promoted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'promoted', v_promoted,
    'skipped', v_skipped,
    'wip_blocked', v_wip_blocked,
    'run_at', now()::text
  );
END;
$function$;
