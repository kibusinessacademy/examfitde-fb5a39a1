
-- Fix validate_all_critical_rpcs to use correct schema_drift_log columns
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
  v_issue record;
BEGIN
  FOR v_rpc IN
    SELECT entity_name FROM schema_contracts
    WHERE contract_type = 'rpc' AND is_critical = true AND deprecated_at IS NULL
  LOOP
    v_check := validate_function_references(v_rpc.entity_name);
    v_results := v_results || v_check;
    v_total_issues := v_total_issues + COALESCE((v_check->>'issue_count')::integer, 0);

    -- Log each issue individually
    IF (v_check->>'issue_count')::integer > 0 THEN
      FOR v_issue IN SELECT * FROM jsonb_array_elements(v_check->'issues') AS elem
      LOOP
        INSERT INTO schema_drift_log (check_source, drift_type, entity_name, expected, actual, is_critical, detected_at)
        VALUES (
          'validate_all_critical_rpcs',
          v_issue.elem->>'type',
          v_issue.elem->>'entity',
          v_issue.elem->>'context',
          'not_found',
          true,
          now()
        );
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_total_issues = 0 THEN 'all_clean' ELSE 'drift_detected' END,
    'total_issues', v_total_issues,
    'rpcs_checked', jsonb_array_length(v_results),
    'checked_at', now(),
    'results', v_results
  );
END;
$$;

-- Fix event trigger function too
CREATE OR REPLACE FUNCTION public.fn_guard_function_references()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_obj record;
  v_func_name text;
  v_check jsonb;
  v_is_critical boolean;
  v_issue record;
BEGIN
  FOR v_obj IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF v_obj.command_tag IN ('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION') THEN
      v_func_name := split_part(split_part(v_obj.object_identity, '(', 1), '.', 2);
      
      IF v_func_name IS NULL OR v_func_name = '' THEN
        CONTINUE;
      END IF;

      SELECT EXISTS(
        SELECT 1 FROM schema_contracts
        WHERE contract_type = 'rpc' AND entity_name = v_func_name
          AND is_critical = true AND deprecated_at IS NULL
      ) INTO v_is_critical;

      IF v_is_critical THEN
        v_check := validate_function_references(v_func_name);
        
        IF (v_check->>'issue_count')::integer > 0 THEN
          FOR v_issue IN SELECT * FROM jsonb_array_elements(v_check->'issues') AS elem
          LOOP
            INSERT INTO schema_drift_log (check_source, drift_type, entity_name, expected, actual, is_critical, detected_at)
            VALUES (
              'ddl_event_trigger',
              v_issue.elem->>'type',
              v_issue.elem->>'entity',
              v_issue.elem->>'context',
              'not_found',
              true,
              now()
            );
          END LOOP;

          RAISE WARNING '[SCHEMA-FIX-GUARD] Function "%" references non-existent schema entities: %',
            v_func_name, v_check->'issues';
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
$$;
