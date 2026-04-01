
-- ============================================================
-- DRIFT-SCANNER v2: Write-Operation Detection
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_function_references(p_func_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_func_body text;
  v_issues jsonb := '[]'::jsonb;
  v_table_ref record;
  v_col_ref record;
  v_table_exists boolean;
  v_col_exists boolean;
  v_known_tables text[];
  v_is_substr boolean;
  v_is_cte boolean;
  v_excluded_words text[] := ARRAY[
    'select', 'where', 'and', 'or', 'not', 'null', 'true', 'false',
    'then', 'else', 'end', 'loop', 'begin', 'declare', 'record',
    'case', 'when', 'into', 'limit', 'order', 'group', 'having',
    'lateral', 'coalesce', 'exists', 'format', 'count', 'avg', 'sum',
    'min', 'max', 'round', 'now', 'array', 'value', 'strict',
    'boolean', 'text', 'integer', 'numeric', 'uuid', 'jsonb', 'json',
    'void', 'bigint', 'smallint', 'real', 'double',
    'jsonb_build_object', 'jsonb_array_length', 'jsonb_array_elements',
    'split_part', 'regexp_matches', 'pg_get_functiondef',
    'lc', 'comp', 'lf', 'ucp', 'src', 'cur', 'elem', 'sub',
    'new', 'old', 'tg_op', 'tg_table_name', 'set', 'values',
    'raise', 'notice', 'exception', 'warning', 'perform',
    'conflict', 'nothing', 'returning'
  ];
  v_pg_catalog_tables text[] := ARRAY[
    'pg_proc', 'pg_namespace', 'pg_class', 'pg_trigger', 'pg_tables',
    'pg_policies', 'pg_event_trigger', 'pg_depend', 'pg_type',
    'pg_attribute', 'pg_index', 'pg_constraint', 'pg_stat_activity',
    'pg_event_trigger_ddl_commands'
  ];
BEGIN
  -- Get function body
  SELECT prosrc INTO v_func_body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = p_func_name;

  IF v_func_body IS NULL THEN
    RETURN jsonb_build_object('function', p_func_name, 'status', 'not_found', 'issues', v_issues);
  END IF;

  -- Collect all known public tables/views
  SELECT ARRAY(
    SELECT table_name::text FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    UNION
    SELECT table_name::text FROM information_schema.views
    WHERE table_schema = 'public'
  ) INTO v_known_tables;

  -- ============================================================
  -- LAYER 1: Table references from READ operations (FROM/JOIN)
  -- ============================================================
  FOR v_table_ref IN
    SELECT DISTINCT m[1] AS ref_table
    FROM regexp_matches(v_func_body, '(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)\s', 'gi') AS m
    WHERE lower(m[1]) != ALL(v_excluded_words)
    AND m[1] !~ '^v_' AND length(m[1]) > 2
  LOOP
    IF lower(v_table_ref.ref_table) = ANY(v_pg_catalog_tables) THEN CONTINUE; END IF;
    SELECT EXISTS(SELECT 1 FROM unnest(v_known_tables) t WHERE t = v_table_ref.ref_table) INTO v_table_exists;
    IF NOT v_table_exists THEN
      SELECT EXISTS(SELECT 1 FROM unnest(v_known_tables) t WHERE t LIKE '%' || v_table_ref.ref_table || '%') INTO v_is_substr;
      IF NOT v_is_substr THEN
        v_is_cte := v_func_body ~* (v_table_ref.ref_table || '\s+AS\s*\(');
        IF NOT v_is_cte THEN
          v_issues := v_issues || jsonb_build_object(
            'type', 'missing_table_reference', 'entity', v_table_ref.ref_table,
            'op', 'READ',
            'context', format('Function %s references non-existent table/view in FROM/JOIN: %s', p_func_name, v_table_ref.ref_table),
            'severity', 'critical'
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- ============================================================
  -- LAYER 2: Table references from WRITE operations
  --   UPDATE <table>, INSERT INTO <table>, DELETE FROM <table>
  -- ============================================================
  FOR v_table_ref IN
    SELECT DISTINCT m[1] AS ref_table, m[2] AS op_type
    FROM (
      -- UPDATE <table>
      SELECT regexp_matches(v_func_body, 'UPDATE\s+(?:public\.)?([a-z_][a-z0-9_]*)\s', 'gi') AS m, 'UPDATE' AS op
      UNION ALL
      -- INSERT INTO <table>
      SELECT regexp_matches(v_func_body, 'INSERT\s+INTO\s+(?:public\.)?([a-z_][a-z0-9_]*)', 'gi'), 'INSERT'
      UNION ALL
      -- DELETE FROM <table>
      SELECT regexp_matches(v_func_body, 'DELETE\s+FROM\s+(?:public\.)?([a-z_][a-z0-9_]*)', 'gi'), 'DELETE'
    ) sub(m, op)
    CROSS JOIN LATERAL (SELECT m[1], op) AS expanded(ref_table_name, op_type)
    WHERE lower(m[1]) != ALL(v_excluded_words)
    AND m[1] !~ '^v_' AND length(m[1]) > 2
  LOOP
    IF lower(v_table_ref.ref_table) = ANY(v_pg_catalog_tables) THEN CONTINUE; END IF;
    SELECT EXISTS(SELECT 1 FROM unnest(v_known_tables) t WHERE t = v_table_ref.ref_table) INTO v_table_exists;
    IF NOT v_table_exists THEN
      SELECT EXISTS(SELECT 1 FROM unnest(v_known_tables) t WHERE t LIKE '%' || v_table_ref.ref_table || '%') INTO v_is_substr;
      IF NOT v_is_substr THEN
        v_is_cte := v_func_body ~* (v_table_ref.ref_table || '\s+AS\s*\(');
        IF NOT v_is_cte THEN
          v_issues := v_issues || jsonb_build_object(
            'type', 'missing_table_reference', 'entity', v_table_ref.ref_table,
            'op', v_table_ref.op_type,
            'context', format('Function %s references non-existent table in %s: %s', p_func_name, v_table_ref.op_type, v_table_ref.ref_table),
            'severity', 'critical'
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- ============================================================
  -- LAYER 3: Column references (table.column pattern)
  --   Covers both read and write: SELECT t.col, SET col = ..., RETURNING col
  -- ============================================================
  FOR v_col_ref IN
    SELECT DISTINCT m[1] AS ref_table, m[2] AS ref_col
    FROM regexp_matches(v_func_body, '([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)', 'gi') AS m
    WHERE lower(m[1]) != ALL(v_excluded_words)
    AND m[1] !~ '^v_' AND m[2] !~ '^v_'
    AND m[1] NOT IN ('auth', 'pg_proc', 'pg_namespace', 'information_schema', 'storage', 'public')
    AND m[2] NOT IN ('oid', 'nspname', 'proname', 'prosrc', 'uid')
  LOOP
    IF v_col_ref.ref_table = ANY(v_known_tables) THEN
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = v_col_ref.ref_table AND column_name = v_col_ref.ref_col
      ) INTO v_col_exists;
      IF NOT v_col_exists THEN
        v_issues := v_issues || jsonb_build_object(
          'type', 'missing_column_reference',
          'entity', format('%s.%s', v_col_ref.ref_table, v_col_ref.ref_col),
          'context', format('Function %s references non-existent column: %s.%s', p_func_name, v_col_ref.ref_table, v_col_ref.ref_col),
          'severity', 'critical'
        );
      END IF;
    END IF;
  END LOOP;

  -- ============================================================
  -- LAYER 4: SET column = ... in UPDATE statements
  --   Extract table from UPDATE <table> ... SET <col> patterns
  -- ============================================================
  FOR v_col_ref IN
    SELECT DISTINCT m[1] AS ref_table, s[1] AS ref_col
    FROM regexp_matches(v_func_body, 'UPDATE\s+(?:public\.)?([a-z_][a-z0-9_]*)\s', 'gi') AS m,
    LATERAL (
      SELECT regexp_matches(
        substring(v_func_body FROM position(m[1] IN v_func_body) FOR 500),
        'SET\s+([a-z_][a-z0-9_]*)\s*=', 'gi'
      )
    ) AS s
    WHERE length(s[1]) > 2
    AND s[1] NOT IN ('search_path', 'updated_at', 'created_at')
    AND s[1] !~ '^v_'
  LOOP
    IF v_col_ref.ref_table = ANY(v_known_tables) THEN
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = v_col_ref.ref_table AND column_name = v_col_ref.ref_col
      ) INTO v_col_exists;
      IF NOT v_col_exists THEN
        v_issues := v_issues || jsonb_build_object(
          'type', 'missing_set_column',
          'entity', format('%s.%s', v_col_ref.ref_table, v_col_ref.ref_col),
          'context', format('Function %s writes to non-existent column in UPDATE SET: %s.%s', p_func_name, v_col_ref.ref_table, v_col_ref.ref_col),
          'severity', 'critical'
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'function', p_func_name,
    'status', CASE WHEN jsonb_array_length(v_issues) = 0 THEN 'clean' ELSE 'drift_detected' END,
    'issue_count', jsonb_array_length(v_issues),
    'checked_at', now(),
    'issues', v_issues
  );
END;
$$;

-- ============================================================
-- CONTRACT-TESTS: run_rpc_contract_tests()
-- ============================================================

CREATE OR REPLACE FUNCTION public.run_rpc_contract_tests()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_test jsonb;
  v_nba jsonb;
  v_dash jsonb;
  v_pq jsonb;
  v_vfr jsonb;
  v_vfr_write jsonb;
  v_all_critical jsonb;
  v_pass_count int := 0;
  v_fail_count int := 0;
  v_test_pkg_id uuid;
  v_test_cur_id uuid;
BEGIN
  -- ============================================================
  -- TEST 1: validate_function_references – core RPCs clean
  -- ============================================================
  BEGIN
    v_vfr := public.validate_function_references('get_next_best_action');
    IF v_vfr->>'status' = 'clean' THEN
      v_results := v_results || jsonb_build_object('test', 'vfr_nba_clean', 'pass', true);
      v_pass_count := v_pass_count + 1;
    ELSE
      v_results := v_results || jsonb_build_object('test', 'vfr_nba_clean', 'pass', false, 'detail', v_vfr->'issues');
      v_fail_count := v_fail_count + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_results := v_results || jsonb_build_object('test', 'vfr_nba_clean', 'pass', false, 'error', SQLERRM);
    v_fail_count := v_fail_count + 1;
  END;

  BEGIN
    v_vfr := public.validate_function_references('get_dashboard_summary');
    IF v_vfr->>'status' = 'clean' THEN
      v_results := v_results || jsonb_build_object('test', 'vfr_dashboard_clean', 'pass', true);
      v_pass_count := v_pass_count + 1;
    ELSE
      v_results := v_results || jsonb_build_object('test', 'vfr_dashboard_clean', 'pass', false, 'detail', v_vfr->'issues');
      v_fail_count := v_fail_count + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_results := v_results || jsonb_build_object('test', 'vfr_dashboard_clean', 'pass', false, 'error', SQLERRM);
    v_fail_count := v_fail_count + 1;
  END;

  BEGIN
    v_vfr := public.validate_function_references('check_production_quality');
    IF v_vfr->>'status' = 'clean' THEN
      v_results := v_results || jsonb_build_object('test', 'vfr_prodquality_clean', 'pass', true);
      v_pass_count := v_pass_count + 1;
    ELSE
      v_results := v_results || jsonb_build_object('test', 'vfr_prodquality_clean', 'pass', false, 'detail', v_vfr->'issues');
      v_fail_count := v_fail_count + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_results := v_results || jsonb_build_object('test', 'vfr_prodquality_clean', 'pass', false, 'error', SQLERRM);
    v_fail_count := v_fail_count + 1;
  END;

  -- ============================================================
  -- TEST 2: validate_function_references itself clean
  -- ============================================================
  BEGIN
    v_vfr := public.validate_function_references('validate_function_references');
    IF v_vfr->>'status' = 'clean' THEN
      v_results := v_results || jsonb_build_object('test', 'vfr_self_clean', 'pass', true);
      v_pass_count := v_pass_count + 1;
    ELSE
      v_results := v_results || jsonb_build_object('test', 'vfr_self_clean', 'pass', false, 'detail', v_vfr->'issues');
      v_fail_count := v_fail_count + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_results := v_results || jsonb_build_object('test', 'vfr_self_clean', 'pass', false, 'error', SQLERRM);
    v_fail_count := v_fail_count + 1;
  END;

  -- ============================================================
  -- TEST 3: validate_all_critical_rpcs returns valid structure
  -- ============================================================
  BEGIN
    v_all_critical := public.validate_all_critical_rpcs();
    IF v_all_critical IS NOT NULL
       AND v_all_critical ? 'total_issues'
       AND v_all_critical ? 'checked_at'
       AND v_all_critical ? 'results' THEN
      v_results := v_results || jsonb_build_object('test', 'batch_validator_structure', 'pass', true,
        'total_issues', v_all_critical->'total_issues');
      v_pass_count := v_pass_count + 1;
    ELSE
      v_results := v_results || jsonb_build_object('test', 'batch_validator_structure', 'pass', false, 'detail', v_all_critical);
      v_fail_count := v_fail_count + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_results := v_results || jsonb_build_object('test', 'batch_validator_structure', 'pass', false, 'error', SQLERRM);
    v_fail_count := v_fail_count + 1;
  END;

  -- ============================================================
  -- TEST 4: get_next_best_action – auth guard (random UUID = no access)
  -- ============================================================
  BEGIN
    v_nba := public.get_next_best_action(gen_random_uuid());
    -- Should return error or empty since no auth context
    IF v_nba->>'error' IS NOT NULL OR v_nba->>'intent' = 'ONBOARDING' THEN
      v_results := v_results || jsonb_build_object('test', 'nba_unknown_user_safe', 'pass', true,
        'response_type', COALESCE(v_nba->>'error', v_nba->>'intent'));
      v_pass_count := v_pass_count + 1;
    ELSE
      v_results := v_results || jsonb_build_object('test', 'nba_unknown_user_safe', 'pass', false, 'detail', v_nba);
      v_fail_count := v_fail_count + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Auth error = also a pass (access denied is correct)
    IF SQLERRM ILIKE '%access%denied%' OR SQLERRM ILIKE '%unauthorized%' OR SQLERRM ILIKE '%auth%' THEN
      v_results := v_results || jsonb_build_object('test', 'nba_unknown_user_safe', 'pass', true, 'guard', SQLERRM);
      v_pass_count := v_pass_count + 1;
    ELSE
      v_results := v_results || jsonb_build_object('test', 'nba_unknown_user_safe', 'pass', false, 'error', SQLERRM);
      v_fail_count := v_fail_count + 1;
    END IF;
  END;

  -- ============================================================
  -- TEST 5: get_next_best_action – return shape contract
  -- ============================================================
  BEGIN
    v_nba := public.get_next_best_action(gen_random_uuid());
    IF v_nba ? 'intent' AND v_nba ? 'confidence' THEN
      v_results := v_results || jsonb_build_object('test', 'nba_return_shape', 'pass', true);
      v_pass_count := v_pass_count + 1;
    ELSE
      v_results := v_results || jsonb_build_object('test', 'nba_return_shape', 'pass', false, 'keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(v_nba) k));
      v_fail_count := v_fail_count + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- If auth-guarded, check if error is expected
    v_results := v_results || jsonb_build_object('test', 'nba_return_shape', 'pass', false, 'error', SQLERRM);
    v_fail_count := v_fail_count + 1;
  END;

  -- ============================================================
  -- TEST 6: get_dashboard_summary – return shape contract
  -- ============================================================
  BEGIN
    v_dash := public.get_dashboard_summary(gen_random_uuid());
    IF v_dash IS NOT NULL THEN
      v_results := v_results || jsonb_build_object('test', 'dashboard_callable', 'pass', true);
      v_pass_count := v_pass_count + 1;
    ELSE
      v_results := v_results || jsonb_build_object('test', 'dashboard_callable', 'pass', false);
      v_fail_count := v_fail_count + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%access%denied%' OR SQLERRM ILIKE '%unauthorized%' OR SQLERRM ILIKE '%auth%' THEN
      v_results := v_results || jsonb_build_object('test', 'dashboard_callable', 'pass', true, 'guard', SQLERRM);
      v_pass_count := v_pass_count + 1;
    ELSE
      v_results := v_results || jsonb_build_object('test', 'dashboard_callable', 'pass', false, 'error', SQLERRM);
      v_fail_count := v_fail_count + 1;
    END IF;
  END;

  -- ============================================================
  -- TEST 7: check_production_quality – callable with dummy IDs
  -- ============================================================
  BEGIN
    v_test_pkg_id := gen_random_uuid();
    v_test_cur_id := gen_random_uuid();
    v_pq := public.check_production_quality(v_test_pkg_id, v_test_cur_id);
    IF v_pq IS NOT NULL AND v_pq ? 'overall_status' THEN
      v_results := v_results || jsonb_build_object('test', 'prodquality_callable', 'pass', true, 'status', v_pq->>'overall_status');
      v_pass_count := v_pass_count + 1;
    ELSE
      v_results := v_results || jsonb_build_object('test', 'prodquality_callable', 'pass', false, 'detail', v_pq);
      v_fail_count := v_fail_count + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_results := v_results || jsonb_build_object('test', 'prodquality_callable', 'pass', false, 'error', SQLERRM);
    v_fail_count := v_fail_count + 1;
  END;

  -- ============================================================
  -- TEST 8: validate_function_references – not_found for bogus
  -- ============================================================
  BEGIN
    v_vfr := public.validate_function_references('this_function_does_not_exist_xyz');
    IF v_vfr->>'status' = 'not_found' THEN
      v_results := v_results || jsonb_build_object('test', 'vfr_not_found_handling', 'pass', true);
      v_pass_count := v_pass_count + 1;
    ELSE
      v_results := v_results || jsonb_build_object('test', 'vfr_not_found_handling', 'pass', false, 'detail', v_vfr);
      v_fail_count := v_fail_count + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_results := v_results || jsonb_build_object('test', 'vfr_not_found_handling', 'pass', false, 'error', SQLERRM);
    v_fail_count := v_fail_count + 1;
  END;

  RETURN jsonb_build_object(
    'suite', 'rpc_contract_tests',
    'run_at', now(),
    'total', v_pass_count + v_fail_count,
    'passed', v_pass_count,
    'failed', v_fail_count,
    'all_green', v_fail_count = 0,
    'tests', v_results
  );
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION public.run_rpc_contract_tests() TO service_role;
