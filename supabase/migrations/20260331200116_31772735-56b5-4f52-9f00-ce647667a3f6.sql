
-- ═══════════════════════════════════════════════════════════════
-- P0 FIX: Repair-Match Governance & No-Effect Loop Prevention
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1) fn_is_repair_action_eligible: Central SSOT for repair eligibility
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_is_repair_action_eligible(
  p_package_id uuid,
  p_repair_action text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocked_reason text;
  v_integrity_report jsonb;
  v_hard_fail_reasons jsonb;
  v_quality_gate jsonb;
  v_auto_publish_meta jsonb;
  v_validate_meta jsonb;
  v_eligible boolean := false;
  v_reason text := 'no_matching_rule';
  -- Exam-pool-repairable reason codes
  v_exam_pool_reasons text[] := ARRAY[
    'MISSING_LF_COVERAGE', 'TRAP_COVERAGE_LOW', 'UNRESOLVED_QUALITY_FLAGS',
    'exam_qc_flags_unresolved', 'exam_pool_quality_low', 'exam_coverage_gap',
    'REPAIR_NEEDED:UNRESOLVED_QUALITY_FLAGS', 'REPAIR_NEEDED:MISSING_LF_COVERAGE',
    'REPAIR_NEEDED:TRAP_COVERAGE_LOW'
  ];
BEGIN
  -- Fetch package state
  SELECT
    cp.blocked_reason,
    cp.integrity_report,
    cp.integrity_report->'hard_fail_reasons',
    cp.integrity_report->'quality_gate'
  INTO v_blocked_reason, v_integrity_report, v_hard_fail_reasons, v_quality_gate
  FROM public.course_packages cp
  WHERE cp.id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'PACKAGE_NOT_FOUND');
  END IF;

  -- Fetch step metadata for context
  SELECT ps.meta INTO v_auto_publish_meta
  FROM public.package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'auto_publish';

  SELECT ps.meta INTO v_validate_meta
  FROM public.package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'validate_exam_pool';

  -- ── REPAIR ACTION: repair_exam_pool_quality ──
  IF p_repair_action = 'repair_exam_pool_quality' THEN

    -- BLOCK if dominant blocker is integrity/publish gate (not exam-pool specific)
    IF v_blocked_reason IS NOT NULL AND (
      v_blocked_reason ILIKE '%AUTO_PUBLISH_GATE_BLOCKED%'
      OR v_blocked_reason ILIKE '%INTEGRITY_REPORT_MISSING%'
      OR v_blocked_reason ILIKE '%INTEGRITY_REPORT_STALE%'
      OR v_blocked_reason ILIKE '%deterministic_publish_gate_failure%'
    ) THEN
      -- Check if hard_fail_reasons contain exam-pool-specific codes
      IF v_hard_fail_reasons IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_hard_fail_reasons) AS r(reason)
          WHERE r.reason = ANY(v_exam_pool_reasons)
        ) THEN
          v_eligible := true;
          v_reason := 'hard_fail_contains_exam_pool_reason';
        ELSE
          v_eligible := false;
          v_reason := 'blocked_by_non_exam_pool_gate: ' || left(v_blocked_reason, 100);
        END IF;
      ELSE
        v_eligible := false;
        v_reason := 'blocked_by_publish_gate_no_exam_pool_cause';
      END IF;

    -- ALLOW if blocked_reason is directly exam-pool related
    ELSIF v_blocked_reason IS NOT NULL AND (
      v_blocked_reason ILIKE '%MISSING_LF_COVERAGE%'
      OR v_blocked_reason ILIKE '%TRAP_COVERAGE_LOW%'
      OR v_blocked_reason ILIKE '%UNRESOLVED_QUALITY_FLAGS%'
    ) THEN
      v_eligible := true;
      v_reason := 'blocked_reason_is_exam_pool_specific';

    -- ALLOW if no blocked_reason (standard pipeline flow)
    ELSIF v_blocked_reason IS NULL THEN
      v_eligible := true;
      v_reason := 'no_blocker_standard_flow';

    -- ALLOW if validate_exam_pool has gate_blocked with exam-pool diagnosis
    ELSIF v_validate_meta IS NOT NULL AND v_validate_meta->>'gate_blocked' = 'true' THEN
      v_eligible := true;
      v_reason := 'validate_exam_pool_gate_blocked';

    ELSE
      v_eligible := false;
      v_reason := 'blocked_reason_not_exam_pool_repairable: ' || left(coalesce(v_blocked_reason, 'null'), 100);
    END IF;

    -- ADDITIONAL GUARD: Check for recent no-effect repairs (loop suppression)
    IF v_eligible THEN
      DECLARE
        v_recent_no_effect int := 0;
      BEGIN
        SELECT count(*) INTO v_recent_no_effect
        FROM public.auto_heal_log ahl
        WHERE ahl.target_id = p_package_id::text
          AND ahl.action_type = 'repair_exam_pool_quality'
          AND ahl.result_status = 'blocked_no_effect'
          AND ahl.created_at > now() - interval '6 hours';

        IF v_recent_no_effect >= 2 THEN
          v_eligible := false;
          v_reason := 'suppressed_after_' || v_recent_no_effect || '_no_effect_repairs_in_6h';
        END IF;
      END;
    END IF;

    RETURN jsonb_build_object('eligible', v_eligible, 'reason', v_reason);
  END IF;

  -- Default: unknown repair action → not eligible
  RETURN jsonb_build_object('eligible', false, 'reason', 'unknown_repair_action: ' || p_repair_action);
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- 2) fn_capture_gate_snapshot: Captures gate state for delta comparison
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_capture_gate_snapshot(
  p_package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snap jsonb;
BEGIN
  SELECT jsonb_build_object(
    'integrity_passed', (cp.integrity_report->>'integrity_passed')::boolean,
    'quality_gate_passed', (cp.integrity_report->>'quality_gate_passed')::boolean,
    'blocked_reason', cp.blocked_reason,
    'hard_fail_reasons', cp.integrity_report->'hard_fail_reasons',
    'integrity_report_version', cp.integrity_report_version,
    'captured_at', now()
  )
  INTO v_snap
  FROM public.course_packages cp
  WHERE cp.id = p_package_id;

  RETURN COALESCE(v_snap, '{}'::jsonb);
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- 3) fn_has_gate_state_changed: Compares pre/post repair snapshots
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_has_gate_state_changed(
  p_pre_snapshot jsonb,
  p_post_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_changed boolean := false;
  v_deltas jsonb := '[]'::jsonb;
BEGIN
  -- Check integrity_passed change
  IF (p_pre_snapshot->>'integrity_passed') IS DISTINCT FROM (p_post_snapshot->>'integrity_passed') THEN
    v_changed := true;
    v_deltas := v_deltas || jsonb_build_array(jsonb_build_object(
      'field', 'integrity_passed',
      'before', p_pre_snapshot->>'integrity_passed',
      'after', p_post_snapshot->>'integrity_passed'
    ));
  END IF;

  -- Check quality_gate_passed change
  IF (p_pre_snapshot->>'quality_gate_passed') IS DISTINCT FROM (p_post_snapshot->>'quality_gate_passed') THEN
    v_changed := true;
    v_deltas := v_deltas || jsonb_build_array(jsonb_build_object(
      'field', 'quality_gate_passed',
      'before', p_pre_snapshot->>'quality_gate_passed',
      'after', p_post_snapshot->>'quality_gate_passed'
    ));
  END IF;

  -- Check blocked_reason change
  IF (p_pre_snapshot->>'blocked_reason') IS DISTINCT FROM (p_post_snapshot->>'blocked_reason') THEN
    v_changed := true;
    v_deltas := v_deltas || jsonb_build_array(jsonb_build_object(
      'field', 'blocked_reason',
      'before', p_pre_snapshot->>'blocked_reason',
      'after', p_post_snapshot->>'blocked_reason'
    ));
  END IF;

  -- Check hard_fail_reasons change
  IF (p_pre_snapshot->'hard_fail_reasons')::text IS DISTINCT FROM (p_post_snapshot->'hard_fail_reasons')::text THEN
    v_changed := true;
    v_deltas := v_deltas || jsonb_build_array(jsonb_build_object(
      'field', 'hard_fail_reasons',
      'before', p_pre_snapshot->'hard_fail_reasons',
      'after', p_post_snapshot->'hard_fail_reasons'
    ));
  END IF;

  -- Check integrity_report_version change
  IF (p_pre_snapshot->>'integrity_report_version') IS DISTINCT FROM (p_post_snapshot->>'integrity_report_version') THEN
    v_changed := true;
    v_deltas := v_deltas || jsonb_build_array(jsonb_build_object(
      'field', 'integrity_report_version',
      'before', p_pre_snapshot->>'integrity_report_version',
      'after', p_post_snapshot->>'integrity_report_version'
    ));
  END IF;

  RETURN jsonb_build_object('changed', v_changed, 'deltas', v_deltas);
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- 4) Update recover_and_reenter_package:
--    - Normalize 'applied' → 'success'
--    - Add gate-delta verification guard
-- ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.recover_and_reenter_package(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.recover_and_reenter_package(
  p_package_id uuid,
  p_reason text,
  p_trigger_source text DEFAULT 'admin_ops',
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg public.course_packages%rowtype;
  v_now timestamptz := now();
  v_active_jobs int := 0;
  v_reset_steps int := 0;
  v_reentered boolean := false;
  v_eligible boolean := false;
  v_final_status text;
  v_recent_no_effect int := 0;
BEGIN
  SELECT * INTO v_pkg FROM public.course_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'package_id', p_package_id, 'error', 'PACKAGE_NOT_FOUND');
  END IF;

  SELECT count(*) INTO v_active_jobs
  FROM public.job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.status IN ('pending', 'queued', 'processing', 'running', 'batch_pending');

  IF v_active_jobs > 0 THEN
    INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
    VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text, 'skipped', 'Skipped: active jobs exist', v_now,
      jsonb_build_object('package_status', v_pkg.status, 'active_jobs', v_active_jobs, 'reason', p_reason, 'actor_user_id', p_actor_user_id));
    RETURN jsonb_build_object('ok', false, 'package_id', p_package_id, 'reason', 'ACTIVE_JOBS_EXIST', 'active_jobs', v_active_jobs,
      'reset_steps', 0, 'eligible_for_reentry', false, 'reentered', false, 'final_status', v_pkg.status);
  END IF;

  -- ── NO-EFFECT LOOP GUARD ──
  -- If recent repairs completed without gate state change, block reentry
  IF p_trigger_source NOT IN ('admin_ops', 'manual') THEN
    SELECT count(*) INTO v_recent_no_effect
    FROM public.auto_heal_log ahl
    WHERE ahl.target_id = p_package_id::text
      AND ahl.action_type IN ('repair_exam_pool_quality', 'recover_and_reenter_package')
      AND ahl.result_status = 'blocked_no_effect'
      AND ahl.created_at > v_now - interval '6 hours';

    IF v_recent_no_effect >= 2 THEN
      INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
      VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text, 'blocked_no_effect',
        'Blocked: ' || v_recent_no_effect || ' recent no-effect repairs detected, preventing loop', v_now,
        jsonb_build_object('package_status', v_pkg.status, 'recent_no_effect_count', v_recent_no_effect,
          'reason', p_reason, 'blocked_reason', v_pkg.blocked_reason));
      RETURN jsonb_build_object('ok', false, 'package_id', p_package_id, 'reason', 'NO_EFFECT_LOOP_SUPPRESSED',
        'reset_steps', 0, 'eligible_for_reentry', false, 'reentered', false, 'final_status', v_pkg.status,
        'recent_no_effect_repairs', v_recent_no_effect);
    END IF;
  END IF;

  -- Reset failed/blocked/timeout steps to queued
  WITH reset AS (
    UPDATE public.package_steps ps
    SET status = 'queued',
        attempts = 0,
        updated_at = v_now,
        started_at = null,
        finished_at = null,
        last_error = left(coalesce(ps.last_error, '') || ' | reset:' || p_reason, 1000),
        meta = (
          CASE WHEN ps.meta IS NOT NULL
          THEN jsonb_strip_nulls(ps.meta - '{loop_guard_blocked,guard_state,consecutive_no_progress,grace_until,stall_reason_code}'::text[])
               || jsonb_build_object('recovered_at', v_now, 'recover_reason', p_reason)
          ELSE jsonb_build_object('recovered_at', v_now, 'recover_reason', p_reason)
          END
        )
    WHERE ps.package_id = p_package_id
      AND ps.status IN ('failed', 'blocked', 'timeout')
    RETURNING ps.step_key
  )
  SELECT count(*) INTO v_reset_steps FROM reset;

  v_eligible := (v_reset_steps > 0) OR (v_pkg.status IN ('blocked', 'quality_gate_failed', 'failed'));

  IF v_eligible THEN
    -- Archive competing visible packages
    IF v_pkg.curriculum_id IS NOT NULL THEN
      UPDATE public.course_packages
      SET status = 'archived', updated_at = v_now
      WHERE curriculum_id = v_pkg.curriculum_id
        AND id <> p_package_id
        AND status IN ('planning','queued','building','failed','published','draft');
    END IF;

    -- Clear BOTH blocked_reason AND stuck_reason
    UPDATE public.course_packages
    SET status = 'building',
        stuck_reason = null,
        blocked_reason = null,
        updated_at = v_now
    WHERE id = p_package_id;

    v_reentered := true;
    v_final_status := 'building';
  ELSE
    v_final_status := v_pkg.status;
  END IF;

  -- NORMALIZED: 'success' instead of 'applied'
  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
  VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text,
    CASE WHEN v_reentered THEN 'success' ELSE 'skipped' END,
    'Reset ' || v_reset_steps || ' steps, reentry=' || v_reentered, v_now,
    jsonb_build_object('package_status_before', v_pkg.status, 'final_status', v_final_status, 'reset_steps', v_reset_steps,
      'reason', p_reason, 'actor_user_id', p_actor_user_id, 'blocked_reason_cleared', v_pkg.blocked_reason IS NOT NULL));

  RETURN jsonb_build_object(
    'ok', true, 'package_id', p_package_id,
    'reset_steps', v_reset_steps,
    'eligible_for_reentry', v_eligible,
    'reentered', v_reentered,
    'final_status', v_final_status,
    'reason', p_reason
  );
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- 5) Consolidate historical 'applied' → 'success' for recover_and_reenter_package
-- ────────────────────────────────────────────────────────────────
UPDATE public.auto_heal_log
SET result_status = 'success'
WHERE action_type = 'recover_and_reenter_package'
  AND result_status = 'applied'
  AND created_at >= now() - interval '30 days';
