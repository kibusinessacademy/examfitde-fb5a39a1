CREATE OR REPLACE FUNCTION public.fn_is_repair_action_eligible(p_package_id uuid, p_repair_action text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_gate jsonb;
  v_gate_status text;
  v_gate_recommended text;
  v_gate_reason_codes jsonb;
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

  v_hard_fail_text := coalesce(v_hard_fail_reasons::text, '');

  -- ── REPAIR ACTION: enqueue_lf_coverage_repair (D+ Phase 2) ──
  IF p_repair_action = 'enqueue_lf_coverage_repair' THEN
    -- Authoritative check via fn_classify_exam_pool_gate
    BEGIN
      v_gate := public.fn_classify_exam_pool_gate(p_package_id);
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'classify_failed: ' || SQLERRM);
    END;

    v_gate_status := v_gate->>'gate_status';
    v_gate_recommended := v_gate->>'recommended_action';
    v_gate_reason_codes := v_gate->'reason_codes';

    IF v_gate_status = 'PASS' THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'gate_status_pass');
    END IF;

    IF (v_gate->>'hard_fail')::boolean IS TRUE
       AND NOT (v_gate_reason_codes::text ILIKE '%REPAIR_LF_COVERAGE%') THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'hard_fail_non_coverage');
    END IF;

    IF v_gate_recommended = 'enqueue_lf_coverage_repair' THEN
      RETURN jsonb_build_object('eligible', true, 'reason', 'gate_recommends_lf_coverage_repair');
    END IF;

    -- Allow when reason_codes signal coverage even if recommended differs (defensive)
    IF v_gate_reason_codes::text ILIKE '%REPAIR_LF_COVERAGE%' THEN
      RETURN jsonb_build_object('eligible', true, 'reason', 'reason_codes_indicate_coverage_repair');
    END IF;

    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'recommended_action_mismatch:' || coalesce(v_gate_recommended, 'null')
    );
  END IF;

  -- ── REPAIR ACTION: repair_exam_pool_quality ──
  IF p_repair_action = 'repair_exam_pool_quality' THEN
    IF v_blocked_reason IS NOT NULL AND (
      v_blocked_reason ILIKE '%AUTO_PUBLISH_GATE_BLOCKED%'
      OR v_blocked_reason ILIKE '%INTEGRITY_REPORT_MISSING%'
      OR v_blocked_reason ILIKE '%INTEGRITY_REPORT_STALE%'
      OR v_blocked_reason ILIKE '%deterministic_publish_gate_failure%'
      OR v_blocked_reason ILIKE '%REPAIR_NO_EFFECT%'
    ) THEN
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
    ELSIF v_blocked_reason IS NOT NULL AND (
      v_blocked_reason ILIKE '%MISSING_LF_COVERAGE%'
      OR v_blocked_reason ILIKE '%TRAP_COVERAGE_LOW%'
      OR v_blocked_reason ILIKE '%UNRESOLVED_QUALITY_FLAGS%'
    ) THEN
      v_eligible := true;
      v_reason := 'blocked_reason_is_exam_pool_specific';
    ELSIF v_blocked_reason IS NULL THEN
      v_eligible := true;
      v_reason := 'no_blocker_standard_flow';
    ELSE
      v_eligible := false;
      v_reason := 'blocked_by_unrelated_reason: ' || left(v_blocked_reason, 100);
    END IF;

    RETURN jsonb_build_object('eligible', v_eligible, 'reason', v_reason);
  END IF;

  -- Default: unknown action → fail-closed
  RETURN jsonb_build_object('eligible', false, 'reason', 'unknown_repair_action: ' || p_repair_action);
END;
$function$;