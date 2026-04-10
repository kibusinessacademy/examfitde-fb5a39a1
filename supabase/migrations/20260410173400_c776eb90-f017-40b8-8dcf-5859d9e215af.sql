
CREATE OR REPLACE FUNCTION fn_classify_validate_guard(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curr record;
  v_prev record;
  v_step_meta jsonb := '{}'::jsonb;
  v_step_attempts int := 0;
  v_active_validate int := 0;
  v_active_repair int := 0;
  v_validate_24h int := 0;
  v_repair_24h int := 0;
  v_has_lease boolean := false;
  v_grace_until timestamptz := null;
  v_consecutive_no_progress int := 0;
  v_progress boolean := false;
  v_delta_approved int := 0;
  v_delta_review int := 0;
  v_delta_unresolved int := 0;
  v_delta_lf int := 0;
  v_delta_competency int := 0;
  v_gate_result jsonb;
  v_gate_status text;
BEGIN
  -- ═══════════════════════════════════════════════════════
  -- CRITICAL FIX: Check gate classification FIRST.
  -- If the gate says PASS, skip all delta/repair logic.
  -- This prevents the "zero-deficit infinite loop" bug where
  -- packages with no deficits get stuck in REPAIR_RUNNING_AWAITING_DELTA
  -- because snapshot deltas are 0 (nothing to improve).
  -- ═══════════════════════════════════════════════════════
  v_gate_result := fn_classify_exam_pool_gate(p_package_id);
  v_gate_status := v_gate_result->>'gate_status';

  IF v_gate_status = 'PASS' THEN
    RETURN jsonb_build_object(
      'guard_state', 'pass_ready',
      'reason_code', 'GATE_PASS',
      'action', 'mark_step_done',
      'gate_result', v_gate_result
    );
  END IF;

  -- If gate says HARD_FAIL, stop immediately
  IF v_gate_status = 'HARD_FAIL' THEN
    RETURN jsonb_build_object(
      'guard_state', 'hard_stalled',
      'reason_code', v_gate_result->'reason_codes'->>0,
      'action', 'block',
      'gate_result', v_gate_result
    );
  END IF;

  -- ── Original guard logic for non-PASS, non-HARD_FAIL cases ──

  SELECT * INTO v_curr
  FROM public.exam_pool_validation_snapshots
  WHERE package_id = p_package_id
  ORDER BY created_at DESC, id DESC LIMIT 1;

  SELECT * INTO v_prev
  FROM public.exam_pool_validation_snapshots
  WHERE package_id = p_package_id
  ORDER BY created_at DESC, id DESC OFFSET 1 LIMIT 1;

  SELECT COALESCE(meta, '{}'::jsonb), COALESCE(attempts, 0)
  INTO v_step_meta, v_step_attempts
  FROM public.package_steps
  WHERE package_id = p_package_id AND step_key = 'validate_exam_pool'
  LIMIT 1;

  SELECT
    COUNT(*) FILTER (WHERE job_type = 'package_validate_exam_pool' AND status IN ('pending','queued','processing','running','batch_pending')),
    COUNT(*) FILTER (WHERE job_type = 'package_repair_exam_pool_quality' AND status IN ('pending','queued','processing','running','batch_pending')),
    COUNT(*) FILTER (WHERE job_type = 'package_validate_exam_pool' AND created_at > now() - interval '24 hours'),
    COUNT(*) FILTER (WHERE job_type = 'package_repair_exam_pool_quality' AND created_at > now() - interval '24 hours')
  INTO v_active_validate, v_active_repair, v_validate_24h, v_repair_24h
  FROM public.job_queue
  WHERE package_id = p_package_id
    AND job_type IN ('package_validate_exam_pool', 'package_repair_exam_pool_quality');

  SELECT EXISTS (
    SELECT 1 FROM public.package_leases
    WHERE package_id = p_package_id AND lease_until > now()
  ) INTO v_has_lease;

  v_grace_until := CASE
    WHEN COALESCE(v_step_meta->>'grace_until', '') <> ''
    THEN (v_step_meta->>'grace_until')::timestamptz
    ELSE NULL
  END;
  v_consecutive_no_progress := COALESCE((v_step_meta->>'consecutive_no_progress')::int, 0);

  IF v_curr IS NOT NULL AND v_prev IS NOT NULL THEN
    v_delta_approved := COALESCE(v_curr.approved_count,0) - COALESCE(v_prev.approved_count,0);
    v_delta_review := COALESCE(v_curr.review_count,0) - COALESCE(v_prev.review_count,0);
    v_delta_unresolved := COALESCE(v_curr.unresolved_quality_flags,0) - COALESCE(v_prev.unresolved_quality_flags,0);
    v_delta_lf := COALESCE(v_curr.missing_lf_coverage,0) - COALESCE(v_prev.missing_lf_coverage,0);
    v_delta_competency := COALESCE(v_curr.missing_competency_coverage,0) - COALESCE(v_prev.missing_competency_coverage,0);
  END IF;

  v_progress := (v_delta_approved > 0) OR (v_delta_review < 0) OR (v_delta_unresolved < 0) OR (v_delta_lf < 0) OR (v_delta_competency < 0);

  IF v_progress THEN
    RETURN jsonb_build_object('guard_state','healthy','reason_code',null,'action','allow',
      'delta_approved',v_delta_approved,'delta_review',v_delta_review,
      'delta_unresolved_flags',v_delta_unresolved,'delta_missing_lf_coverage',v_delta_lf,
      'delta_missing_competency_coverage',v_delta_competency,
      'gate_status', v_gate_status);
  END IF;

  IF v_grace_until IS NOT NULL AND v_grace_until > now() THEN
    RETURN jsonb_build_object('guard_state','recovering','reason_code','RECENT_HEAL_GRACE_ACTIVE','action','allow_wait','grace_until',v_grace_until);
  END IF;

  -- ═══════════════════════════════════════════════════════
  -- HARDENED: Add no-progress circuit breaker.
  -- After 10 consecutive no-progress cycles with no active jobs,
  -- escalate to hard_stalled instead of endlessly requeuing.
  -- ═══════════════════════════════════════════════════════
  IF v_consecutive_no_progress >= 10
     AND v_active_validate = 0 AND v_active_repair = 0 AND NOT v_has_lease THEN
    RETURN jsonb_build_object(
      'guard_state', 'hard_stalled',
      'reason_code', 'NO_PROGRESS_CIRCUIT_BREAKER',
      'action', 'block',
      'consecutive_no_progress', v_consecutive_no_progress,
      'gate_status', v_gate_status,
      'gate_result', v_gate_result
    );
  END IF;

  IF v_active_validate > 0 OR v_active_repair > 0 OR v_has_lease THEN
    RETURN jsonb_build_object('guard_state','recovering','reason_code','REPAIR_RUNNING_AWAITING_DELTA','action','allow_wait',
      'active_validate',v_active_validate,'active_repair',v_active_repair,'has_active_lease',v_has_lease);
  END IF;

  IF v_validate_24h >= 6 AND v_consecutive_no_progress >= 2 AND v_repair_24h = 0 THEN
    RETURN jsonb_build_object('guard_state','soft_stalled','reason_code','VALIDATE_EXAM_POOL_SOFT_STALL','action','enqueue_repair',
      'validate_attempts_24h',v_validate_24h,'consecutive_no_progress',v_consecutive_no_progress);
  END IF;

  IF v_validate_24h >= 12 AND v_consecutive_no_progress >= 4 AND v_repair_24h >= 2
     AND v_active_validate = 0 AND v_active_repair = 0 AND NOT v_has_lease
     AND (v_grace_until IS NULL OR v_grace_until <= now()) THEN
    RETURN jsonb_build_object('guard_state','hard_stalled','reason_code','VALIDATE_EXAM_POOL_TRUE_STALL','action','block',
      'validate_attempts_24h',v_validate_24h,'repair_attempts_24h',v_repair_24h,'consecutive_no_progress',v_consecutive_no_progress);
  END IF;

  IF v_consecutive_no_progress >= 2 THEN
    RETURN jsonb_build_object('guard_state','soft_stalled','reason_code','NO_PROGRESS_AFTER_REPAIR','action','requeue_validate',
      'consecutive_no_progress',v_consecutive_no_progress);
  END IF;

  RETURN jsonb_build_object('guard_state','healthy','reason_code',null,'action','allow');
END;
$$;
