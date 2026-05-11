-- Restore canonical 6-arg admin_step_reset_detailed (operator/allow_regression/clear_exhaustion).
-- The compat 5-arg shim (p_source, p_nudge_atomic) recursively calls this overload; it was
-- dropped on 2026-05-02 leaving the shim broken. Frontend healDiagnostics.stepResetDetailed
-- calls with the 6-arg shape directly, so we restore it explicitly.

CREATE OR REPLACE FUNCTION public.admin_step_reset_detailed(
  p_package_id UUID,
  p_step_keys TEXT[],
  p_reason TEXT,
  p_operator TEXT DEFAULT NULL,
  p_allow_regression BOOLEAN DEFAULT true,
  p_clear_exhaustion BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results JSONB := '[]'::jsonb;
  v_step RECORD;
  v_op TEXT := COALESCE(p_operator, 'admin_manual');
  v_now TIMESTAMPTZ := now();
  v_meta_before JSONB;
  v_meta_after JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_package_id IS NULL THEN
    RAISE EXCEPTION 'admin_step_reset_detailed: p_package_id is required';
  END IF;
  IF p_step_keys IS NULL OR array_length(p_step_keys, 1) IS NULL THEN
    RAISE EXCEPTION 'admin_step_reset_detailed: p_step_keys must be non-empty';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'admin_step_reset_detailed: p_reason is required';
  END IF;

  FOR v_step IN
    SELECT id, step_key, status, meta
    FROM public.package_steps
    WHERE package_id = p_package_id
      AND step_key = ANY(p_step_keys)
    ORDER BY step_key
  LOOP
    v_meta_before := COALESCE(v_step.meta, '{}'::jsonb);
    v_meta_after := v_meta_before;

    IF p_clear_exhaustion THEN
      v_meta_after := v_meta_after - 'exhausted' - 'repair_exhausted' - 'hard_fail_count';
    END IF;

    v_meta_after := v_meta_after || jsonb_build_object(
      'allow_regression', p_allow_regression,
      'allow_regression_by', v_op,
      'allow_regression_at', v_now,
      'admin_bypass_reset_at', v_now,
      'admin_bypass_reason', p_reason
    );

    UPDATE public.package_steps
    SET status = 'queued'::step_status,
        meta = v_meta_after,
        last_error = NULL,
        started_at = NULL,
        finished_at = NULL,
        last_heartbeat_at = NULL,
        runner_id = NULL,
        attempts = 0,
        updated_at = v_now
    WHERE id = v_step.id;

    v_results := v_results || jsonb_build_object(
      'step_key', v_step.step_key,
      'previous_status', v_step.status,
      'meta_diff', jsonb_build_object(
        'cleared_exhaustion', p_clear_exhaustion,
        'allow_regression_set', p_allow_regression
      ),
      'reset_at', v_now
    );
  END LOOP;

  INSERT INTO public.system_heal_log (heal_type, package_id, step_key, details)
  VALUES (
    'manual_step_reset_detailed',
    p_package_id,
    NULL,
    jsonb_build_object(
      'operator', v_op,
      'reason', p_reason,
      'step_keys', p_step_keys,
      'results', v_results
    )
  );

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'admin_step_reset_detailed_restored_v1',
    'package',
    p_package_id,
    'success',
    jsonb_build_object('operator', v_op, 'step_keys', p_step_keys, 'reason', p_reason)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'reset_count', jsonb_array_length(v_results),
    'results', v_results,
    'operator', v_op,
    'reset_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_step_reset_detailed(uuid, text[], text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_step_reset_detailed(uuid, text[], text, text, boolean, boolean) TO authenticated, service_role;

-- Smoke: both overloads resolvable
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM pg_proc WHERE proname='admin_step_reset_detailed';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'expected 2 admin_step_reset_detailed overloads, got %', v_count;
  END IF;
END$$;