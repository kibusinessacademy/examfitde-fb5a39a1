-- Drift-Guard für claim_pending_jobs_* — alert-only, kein Auto-Fix.
-- Scannt pg_proc Bodies, prüft Spalten-Referenzen gegen information_schema,
-- erkennt Legacy-Aliases (worker_id, claimed_by, claimed_at, worker_pool_id, …).

CREATE OR REPLACE FUNCTION public.fn_check_claim_pending_jobs_drift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actual_cols  text[];
  v_forbidden    jsonb := jsonb_build_object(
                    'worker_id',       'locked_by',
                    'claimed_by',      'locked_by',
                    'claimed_at',      'locked_at',
                    'worker_pool_id',  'worker_pool',
                    'lock_owner',      'locked_by',
                    'lock_acquired_at','locked_at'
                  );
  v_findings     jsonb := '[]'::jsonb;
  v_func         record;
  v_match        record;
  v_col          text;
  v_drift_count  int := 0;
  v_legacy_count int := 0;
  v_func_count   int := 0;
BEGIN
  SELECT array_agg(column_name)
    INTO v_actual_cols
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='job_queue';

  FOR v_func IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'claim_pending_jobs%'
  LOOP
    v_func_count := v_func_count + 1;
    -- Extract column refs of the form  jq.<col>  or  job_queue.<col>  or  q.<col>
    FOR v_match IN
      SELECT DISTINCT lower(m[1]) AS col
      FROM regexp_matches(
        v_func.def,
        '(?:\bjq|\bjob_queue|\bq)\.([a-z_][a-z0-9_]*)',
        'gi'
      ) AS m
    LOOP
      v_col := v_match.col;
      -- Skip SQL keywords / function-output aliases that aren't real columns
      IF v_col IN ('id','status','*','count','exists') THEN CONTINUE; END IF;

      IF v_forbidden ? v_col THEN
        v_legacy_count := v_legacy_count + 1;
        v_findings := v_findings || jsonb_build_object(
          'function',  v_func.proname || '(' || v_func.args || ')',
          'kind',      'LEGACY_ALIAS',
          'column',    v_col,
          'expected',  v_forbidden->>v_col,
          'severity',  'critical'
        );
      ELSIF NOT (v_col = ANY(v_actual_cols)) THEN
        v_drift_count := v_drift_count + 1;
        v_findings := v_findings || jsonb_build_object(
          'function',  v_func.proname || '(' || v_func.args || ')',
          'kind',      'UNKNOWN_COLUMN',
          'column',    v_col,
          'expected',  null,
          'severity',  'critical'
        );
      END IF;
    END LOOP;
  END LOOP;

  -- Audit only when drift is found
  IF jsonb_array_length(v_findings) > 0 THEN
    INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata, created_at)
    VALUES (
      'claim_rpc_schema_drift_detected',
      'system',
      'alert',
      jsonb_build_object(
        'functions_scanned', v_func_count,
        'legacy_alias_hits', v_legacy_count,
        'unknown_col_hits',  v_drift_count,
        'findings',          v_findings,
        'job_queue_columns', v_actual_cols
      ),
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',                 jsonb_array_length(v_findings) = 0,
    'functions_scanned',  v_func_count,
    'legacy_alias_hits',  v_legacy_count,
    'unknown_col_hits',   v_drift_count,
    'findings',           v_findings,
    'checked_at',         now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_claim_pending_jobs_drift() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_claim_pending_jobs_drift() TO service_role;

-- Cockpit-RPC mit has_role-Gate
CREATE OR REPLACE FUNCTION public.admin_get_claim_rpc_drift_report()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN public.fn_check_claim_pending_jobs_drift();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_claim_rpc_drift_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_claim_rpc_drift_report() TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_check_claim_pending_jobs_drift IS
  'Scans claim_pending_jobs_* function bodies for legacy column aliases (worker_id→locked_by etc.) and unknown job_queue columns. Alert-only, no auto-fix. Writes auto_heal_log on drift. Single-source-of-truth for worker-claim schema contract.';