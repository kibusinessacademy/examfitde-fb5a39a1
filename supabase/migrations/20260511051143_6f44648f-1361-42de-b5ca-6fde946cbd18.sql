-- E2E Smoke: P1 Recovery-Pulse Role-Gate (Fail-Closed)
-- Provokes role denial as 'authenticated', captures audit entry, then verifies
-- success path via service_role-equivalent invocation (postgres session_user).

CREATE OR REPLACE FUNCTION public.admin_smoke_recovery_pulse_role_gate()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_marker       text := 'smoke_' || gen_random_uuid()::text;
  v_denial_seen  boolean := false;
  v_denial_row   jsonb;
  v_exception    text;
  v_success_ok   boolean := false;
  v_success_err  text;
  v_status_after text;
BEGIN
  -- Admin gate
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  ----------------------------------------------------------------
  -- Phase 1: Provoke role denial (set local role to authenticated)
  ----------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.claim_recovery_pulse(v_marker, 1, 'recovery');
    v_exception := 'NO_EXCEPTION_RAISED';
  EXCEPTION WHEN OTHERS THEN
    v_exception := SQLERRM;
  END;
  RESET ROLE;

  -- Verify audit entry was written
  SELECT to_jsonb(t) INTO v_denial_row
  FROM (
    SELECT action_type, result_status, metadata, created_at
    FROM public.auto_heal_log
    WHERE action_type = 'recovery_pulse_role_denied'
      AND metadata->>'worker_id' = v_marker
    ORDER BY created_at DESC
    LIMIT 1
  ) t;

  v_denial_seen := v_denial_row IS NOT NULL
                AND (v_denial_row->>'result_status') = 'blocked';

  ----------------------------------------------------------------
  -- Phase 2: Verify success path (SECURITY DEFINER → session=postgres)
  ----------------------------------------------------------------
  BEGIN
    PERFORM public.claim_recovery_pulse('smoke_success_' || v_marker, 0, 'recovery');
    v_success_ok := true;
  EXCEPTION WHEN OTHERS THEN
    v_success_err := SQLERRM;
    v_success_ok := false;
  END;

  ----------------------------------------------------------------
  -- Phase 3: Audit own smoke run
  ----------------------------------------------------------------
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES (
    'smoke_recovery_pulse_role_gate',
    'system',
    CASE WHEN v_denial_seen AND v_success_ok THEN 'completed' ELSE 'failed' END,
    jsonb_build_object(
      'caller', v_caller,
      'marker', v_marker,
      'denial_seen', v_denial_seen,
      'denial_exception', v_exception,
      'denial_row', v_denial_row,
      'success_ok', v_success_ok,
      'success_err', v_success_err
    )
  );

  RETURN jsonb_build_object(
    'ok', v_denial_seen AND v_success_ok,
    'phase1_role_denial', jsonb_build_object(
      'denial_seen', v_denial_seen,
      'exception', v_exception,
      'audit_row', v_denial_row
    ),
    'phase2_success_path', jsonb_build_object(
      'ok', v_success_ok,
      'error', v_success_err
    ),
    'marker', v_marker
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_smoke_recovery_pulse_role_gate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_smoke_recovery_pulse_role_gate() TO service_role;

COMMENT ON FUNCTION public.admin_smoke_recovery_pulse_role_gate() IS
'P1 E2E Smoke: provokes claim_recovery_pulse role-denial as authenticated, verifies auto_heal_log audit entry (action=recovery_pulse_role_denied, status=blocked), then verifies success path via SECURITY DEFINER session=postgres. Audit-only.';