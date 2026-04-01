
CREATE OR REPLACE FUNCTION public.validate_all_critical_rpcs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_rpc record;
  v_check jsonb;
  v_total_issues integer := 0;
  v_issue jsonb;
  v_log_skipped boolean := false;
BEGIN
  FOR v_rpc IN
    SELECT entity_name FROM schema_contracts
    WHERE contract_type = 'rpc' AND is_critical = true AND deprecated_at IS NULL
  LOOP
    v_check := validate_function_references(v_rpc.entity_name);
    v_results := v_results || v_check;
    v_total_issues := v_total_issues + COALESCE((v_check->>'issue_count')::integer, 0);

    IF (v_check->>'issue_count')::integer > 0 THEN
      FOR v_issue IN SELECT value FROM jsonb_array_elements(v_check->'issues') AS value
      LOOP
        BEGIN
          INSERT INTO schema_drift_log (check_source, drift_type, entity_name, expected, actual, is_critical, detected_at)
          VALUES (
            'validate_all_critical_rpcs',
            v_issue->>'type',
            v_issue->>'entity',
            v_issue->>'context',
            'not_found',
            true,
            now()
          );
        EXCEPTION WHEN OTHERS THEN
          v_log_skipped := true;
        END;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_total_issues = 0 THEN 'all_clean' ELSE 'drift_detected' END,
    'total_issues', v_total_issues,
    'rpcs_checked', jsonb_array_length(v_results),
    'log_persisted', NOT v_log_skipped,
    'checked_at', now(),
    'results', v_results
  );
END;
$$;
