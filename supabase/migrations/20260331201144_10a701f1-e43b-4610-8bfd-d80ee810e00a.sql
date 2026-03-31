
-- ═══════════════════════════════════════════════════════════════
-- P0 NACHSCHÄRFUNG: Eligibility + Reentry hardening
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1) Harden fn_is_repair_action_eligible:
--    - validate_meta gate_blocked now requires diagnosis code matching
--    - hard_fail_reasons uses text containment (robust for mixed formats)
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
  v_auto_publish_meta jsonb;
  v_validate_meta jsonb;
  v_eligible boolean := false;
  v_reason text := 'no_matching_rule';
  v_exam_pool_reasons text[] := ARRAY[
    'MISSING_LF_COVERAGE', 'TRAP_COVERAGE_LOW', 'UNRESOLVED_QUALITY_FLAGS',
    'exam_qc_flags_unresolved', 'exam_pool_quality_low', 'exam_coverage_gap',
    'REPAIR_NEEDED:UNRESOLVED_QUALITY_FLAGS', 'REPAIR_NEEDED:MISSING_LF_COVERAGE',
    'REPAIR_NEEDED:TRAP_COVERAGE_LOW'
  ];
  v_hard_fail_text text;
  v_gate_diagnosis jsonb;
  v_has_exam_pool_diagnosis boolean := false;
BEGIN
  -- Fetch package state
  SELECT
    cp.blocked_reason,
    cp.integrity_report,
    cp.integrity_report->'hard_fail_reasons'
  INTO v_blocked_reason, v_integrity_report, v_hard_fail_reasons
  FROM public.course_packages cp
  WHERE cp.id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'PACKAGE_NOT_FOUND');
  END IF;

  -- Fetch step metadata
  SELECT ps.meta INTO v_auto_publish_meta
  FROM public.package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'auto_publish';

  SELECT ps.meta INTO v_validate_meta
  FROM public.package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'validate_exam_pool';

  -- Serialize hard_fail_reasons for robust text matching (handles arrays, objects, mixed)
  v_hard_fail_text := coalesce(v_hard_fail_reasons::text, '');

  -- ── REPAIR ACTION: repair_exam_pool_quality ──
  IF p_repair_action = 'repair_exam_pool_quality' THEN

    -- BLOCK if dominant blocker is integrity/publish gate (not exam-pool specific)
    IF v_blocked_reason IS NOT NULL AND (
      v_blocked_reason ILIKE '%AUTO_PUBLISH_GATE_BLOCKED%'
      OR v_blocked_reason ILIKE '%INTEGRITY_REPORT_MISSING%'
      OR v_blocked_reason ILIKE '%INTEGRITY_REPORT_STALE%'
      OR v_blocked_reason ILIKE '%deterministic_publish_gate_failure%'
      OR v_blocked_reason ILIKE '%REPAIR_NO_EFFECT%'
    ) THEN
      -- Check if hard_fail_reasons contain exam-pool-specific codes (text search for robustness)
      IF v_hard_fail_text ILIKE '%MISSING_LF_COVERAGE%'
         OR v_hard_fail_text ILIKE '%TRAP_COVERAGE_LOW%'
         OR v_hard_fail_text ILIKE '%UNRESOLVED_QUALITY_FLAGS%'
      THEN
        v_eligible := true;
        v_reason := 'hard_fail_contains_exam_pool_reason';
      ELSE
        v_eligible := false;
        v_reason := 'blocked_by_non_exam_pool_gate: ' || left(v_blocked_reason, 100);
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

    -- FIX 5: validate_exam_pool gate_blocked now requires DIAGNOSIS CODE MATCHING
    ELSIF v_validate_meta IS NOT NULL AND v_validate_meta->>'gate_blocked' = 'true' THEN
      v_gate_diagnosis := v_validate_meta->'gate_diagnosis';
      IF v_gate_diagnosis IS NOT NULL AND jsonb_typeof(v_gate_diagnosis) = 'array' THEN
        -- Check if any diagnosis code matches exam-pool-repairable reasons
        SELECT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_gate_diagnosis) AS d(diag)
          WHERE d.diag = ANY(v_exam_pool_reasons)
             OR d.diag ILIKE 'REPAIR_NEEDED:%'
        ) INTO v_has_exam_pool_diagnosis;

        IF v_has_exam_pool_diagnosis THEN
          v_eligible := true;
          v_reason := 'validate_gate_blocked_with_exam_pool_diagnosis';
        ELSE
          v_eligible := false;
          v_reason := 'validate_gate_blocked_but_no_exam_pool_diagnosis';
        END IF;
      ELSE
        -- No diagnosis array → not eligible (can't determine if exam-pool-repairable)
        v_eligible := false;
        v_reason := 'validate_gate_blocked_missing_diagnosis_codes';
      END IF;

    ELSE
      v_eligible := false;
      v_reason := 'blocked_reason_not_exam_pool_repairable: ' || left(coalesce(v_blocked_reason, 'null'), 100);
    END IF;

    -- ADDITIONAL GUARD: Suppress after recent no-effect repairs
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

  RETURN jsonb_build_object('eligible', false, 'reason', 'unknown_repair_action: ' || p_repair_action);
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- 2) Harden recover_and_reenter_package:
--    - New p_gate_delta_verified parameter
--    - blocked_reason only cleared when delta verified OR admin-triggered
--    - Auto-heal paths must pass gate_delta_verified=true for full reentry
-- ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.recover_and_reenter_package(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.recover_and_reenter_package(
  p_package_id uuid,
  p_reason text,
  p_trigger_source text DEFAULT 'admin_ops',
  p_actor_user_id uuid DEFAULT NULL,
  p_gate_delta_verified boolean DEFAULT false
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
  v_is_admin boolean;
  v_clear_blocked boolean;
BEGIN
  v_is_admin := p_trigger_source IN ('admin_ops', 'manual');

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

  -- ── NO-EFFECT LOOP GUARD (automation paths only) ──
  IF NOT v_is_admin THEN
    -- Block if recent no-effect repairs detected
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

    -- For automation: require gate_delta_verified for packages with integrity/publish blockers
    IF NOT p_gate_delta_verified AND v_pkg.blocked_reason IS NOT NULL AND (
      v_pkg.blocked_reason ILIKE '%AUTO_PUBLISH_GATE_BLOCKED%'
      OR v_pkg.blocked_reason ILIKE '%integrity%'
      OR v_pkg.blocked_reason ILIKE '%REPAIR_NO_EFFECT%'
    ) THEN
      INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
      VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text, 'blocked_no_effect',
        'Blocked: gate_delta_verified=false for package with integrity/publish blocker', v_now,
        jsonb_build_object('package_status', v_pkg.status, 'blocked_reason', v_pkg.blocked_reason,
          'reason', p_reason, 'gate_delta_verified', false));
      RETURN jsonb_build_object('ok', false, 'package_id', p_package_id, 'reason', 'GATE_DELTA_NOT_VERIFIED',
        'reset_steps', 0, 'eligible_for_reentry', false, 'reentered', false, 'final_status', v_pkg.status);
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

    -- FIX D: Only clear blocked_reason when delta verified OR admin-triggered
    v_clear_blocked := v_is_admin OR p_gate_delta_verified OR v_pkg.blocked_reason IS NULL;

    UPDATE public.course_packages
    SET status = 'building',
        stuck_reason = null,
        blocked_reason = CASE WHEN v_clear_blocked THEN null
                              ELSE 'RECOVER_ATTEMPTED_FROM:' || left(coalesce(v_pkg.blocked_reason, 'unknown'), 100)
                         END,
        updated_at = v_now
    WHERE id = p_package_id;

    v_reentered := true;
    v_final_status := 'building';
  ELSE
    v_final_status := v_pkg.status;
  END IF;

  -- Log with normalized 'success' status
  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
  VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text,
    CASE WHEN v_reentered THEN 'success' ELSE 'skipped' END,
    'Reset ' || v_reset_steps || ' steps, reentry=' || v_reentered || ', gate_delta_verified=' || p_gate_delta_verified, v_now,
    jsonb_build_object('package_status_before', v_pkg.status, 'final_status', v_final_status, 'reset_steps', v_reset_steps,
      'reason', p_reason, 'actor_user_id', p_actor_user_id, 'blocked_reason_cleared', v_clear_blocked,
      'gate_delta_verified', p_gate_delta_verified, 'original_blocked_reason', v_pkg.blocked_reason));

  RETURN jsonb_build_object(
    'ok', true, 'package_id', p_package_id,
    'reset_steps', v_reset_steps,
    'eligible_for_reentry', v_eligible,
    'reentered', v_reentered,
    'final_status', v_final_status,
    'reason', p_reason,
    'gate_delta_verified', p_gate_delta_verified
  );
END;
$$;
