
-- ============================================================
-- Schema-Fix Guard: Automated RPC reference validation
-- ============================================================

-- 1) Function to validate a single function's table/column references
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
  v_tbl text;
  v_match text[];
BEGIN
  -- Get function body
  SELECT prosrc INTO v_func_body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = p_func_name;

  IF v_func_body IS NULL THEN
    RETURN jsonb_build_object(
      'function', p_func_name,
      'status', 'not_found',
      'issues', v_issues
    );
  END IF;

  -- Get all public tables for reference checking
  SELECT ARRAY(
    SELECT table_name::text FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ) INTO v_known_tables;

  -- Pattern 1: "FROM table_name" / "JOIN table_name"
  -- Pattern 2: "INTO table_name" / "UPDATE table_name"
  -- Extract potential table references from function body
  FOR v_table_ref IN
    SELECT DISTINCT m[1] AS ref_table
    FROM regexp_matches(
      v_func_body,
      '(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)\s',
      'gi'
    ) AS m
    WHERE m[1] NOT IN (
      -- Exclude PL/pgSQL keywords and variables
      'select', 'where', 'and', 'or', 'not', 'null', 'true', 'false',
      'then', 'else', 'end', 'loop', 'begin', 'declare', 'record',
      'boolean', 'text', 'integer', 'numeric', 'uuid', 'jsonb', 'json',
      'v_result', 'v_requesting_uid', 'v_has_competency', 'v_has_lessons',
      'v_has_exams', 'lateral', 'strict'
    )
    AND m[1] !~ '^v_'  -- skip variables
  LOOP
    -- Check if table exists
    SELECT EXISTS(
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_table_ref.ref_table
    ) INTO v_table_exists;

    -- Also check if it's a CTE alias or subquery alias (skip)
    IF NOT v_table_exists THEN
      -- Check views too
      SELECT EXISTS(
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'public' AND table_name = v_table_ref.ref_table
      ) INTO v_table_exists;
    END IF;

    IF NOT v_table_exists THEN
      v_issues := v_issues || jsonb_build_object(
        'type', 'missing_table_reference',
        'entity', v_table_ref.ref_table,
        'context', format('Function %s references non-existent table/view: %s', p_func_name, v_table_ref.ref_table),
        'severity', 'critical'
      );
    END IF;
  END LOOP;

  -- Pattern 3: Check "table.column" style references
  FOR v_col_ref IN
    SELECT DISTINCT m[1] AS ref_table, m[2] AS ref_col
    FROM regexp_matches(
      v_func_body,
      '([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)',
      'gi'
    ) AS m
    WHERE m[1] NOT IN (
      'auth', 'pg_proc', 'pg_namespace', 'information_schema', 'storage',
      'v_contract', 'v_bottleneck', 'v_critical_block', 'jsonb_build_object'
    )
    AND m[1] !~ '^v_'
    AND m[2] NOT IN ('oid', 'nspname', 'proname', 'prosrc')
  LOOP
    -- Only validate if the table part is a known table
    IF v_col_ref.ref_table = ANY(v_known_tables) THEN
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = v_col_ref.ref_table
          AND column_name = v_col_ref.ref_col
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

  RETURN jsonb_build_object(
    'function', p_func_name,
    'status', CASE WHEN jsonb_array_length(v_issues) = 0 THEN 'clean' ELSE 'drift_detected' END,
    'issue_count', jsonb_array_length(v_issues),
    'checked_at', now(),
    'issues', v_issues
  );
END;
$$;

-- 2) Validate all critical RPCs at once
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
BEGIN
  FOR v_rpc IN
    SELECT entity_name FROM schema_contracts
    WHERE contract_type = 'rpc' AND is_critical = true AND deprecated_at IS NULL
  LOOP
    v_check := validate_function_references(v_rpc.entity_name);
    v_results := v_results || v_check;
    v_total_issues := v_total_issues + COALESCE((v_check->>'issue_count')::integer, 0);
  END LOOP;

  -- Log if any issues found
  IF v_total_issues > 0 THEN
    INSERT INTO schema_drift_log (drift_type, details, detected_at, resolved)
    VALUES (
      'rpc_reference_drift',
      jsonb_build_object(
        'total_issues', v_total_issues,
        'results', v_results,
        'trigger', 'manual_or_scheduled'
      ),
      now(),
      false
    );
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_total_issues = 0 THEN 'all_clean' ELSE 'drift_detected' END,
    'total_issues', v_total_issues,
    'rpcs_checked', jsonb_array_length(v_results),
    'checked_at', now(),
    'results', v_results
  );
END;
$$;

-- 3) Event trigger function — fires on CREATE/REPLACE FUNCTION
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
BEGIN
  FOR v_obj IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    -- Only process function creation/replacement
    IF v_obj.command_tag IN ('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION') THEN
      -- Extract function name from object identity (schema.funcname(args))
      v_func_name := split_part(split_part(v_obj.object_identity, '(', 1), '.', 2);
      
      IF v_func_name IS NULL OR v_func_name = '' THEN
        CONTINUE;
      END IF;

      -- Check if this is a monitored RPC
      SELECT EXISTS(
        SELECT 1 FROM schema_contracts
        WHERE contract_type = 'rpc'
          AND entity_name = v_func_name
          AND is_critical = true
          AND deprecated_at IS NULL
      ) INTO v_is_critical;

      -- Only validate critical/registered functions to avoid noise
      IF v_is_critical THEN
        v_check := validate_function_references(v_func_name);
        
        IF (v_check->>'issue_count')::integer > 0 THEN
          -- Log the drift
          INSERT INTO schema_drift_log (drift_type, details, detected_at, resolved)
          VALUES (
            'rpc_reference_drift',
            jsonb_build_object(
              'function', v_func_name,
              'trigger', 'ddl_event_trigger',
              'issues', v_check->'issues',
              'issue_count', v_check->>'issue_count'
            ),
            now(),
            false
          );

          -- Raise a warning (does NOT block the DDL, but visible in logs)
          RAISE WARNING '[SCHEMA-FIX-GUARD] Function "%" references non-existent schema entities: %',
            v_func_name, v_check->'issues';
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- 4) Create the event trigger
DROP EVENT TRIGGER IF EXISTS trg_guard_function_references;
CREATE EVENT TRIGGER trg_guard_function_references
  ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION')
  EXECUTE FUNCTION fn_guard_function_references();

-- 5) Register critical RPCs in schema_contracts
INSERT INTO schema_contracts (contract_type, entity_name, is_critical, description, expected_spec)
VALUES
  ('rpc', 'get_next_best_action', true, 
   'Next Best Action Engine v2.1 — deterministic learner state machine',
   '{"references": ["user_competency_progress", "learning_progress", "exam_sessions", "courses", "modules", "lessons", "curricula", "competencies", "learning_fields", "spaced_repetition_cards", "course_enrollments"]}'::jsonb),
  ('rpc', 'get_dashboard_summary', true,
   'Dashboard SSOT RPC — aggregated enrollment data in one call',
   '{"references": ["course_enrollments", "courses", "modules", "lessons", "learning_progress"]}'::jsonb)
ON CONFLICT (contract_type, entity_name) 
  WHERE deprecated_at IS NULL
DO UPDATE SET
  is_critical = EXCLUDED.is_critical,
  description = EXCLUDED.description,
  expected_spec = EXCLUDED.expected_spec,
  updated_at = now();
