
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
    'lc', 'comp', 'lf', 'ucp', 'src', 'cur', 'elem'
  ];
BEGIN
  SELECT prosrc INTO v_func_body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = p_func_name;

  IF v_func_body IS NULL THEN
    RETURN jsonb_build_object('function', p_func_name, 'status', 'not_found', 'issues', v_issues);
  END IF;

  SELECT ARRAY(
    SELECT table_name::text FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    UNION
    SELECT table_name::text FROM information_schema.views
    WHERE table_schema = 'public'
  ) INTO v_known_tables;

  FOR v_table_ref IN
    SELECT DISTINCT m[1] AS ref_table
    FROM regexp_matches(
      v_func_body,
      '(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)\s',
      'gi'
    ) AS m
    WHERE lower(m[1]) != ALL(v_excluded_words)
    AND m[1] !~ '^v_'
    AND length(m[1]) > 2
  LOOP
    -- Check direct match
    SELECT EXISTS(
      SELECT 1 FROM unnest(v_known_tables) t WHERE t = v_table_ref.ref_table
    ) INTO v_table_exists;

    IF NOT v_table_exists THEN
      -- Skip if it's a substring of a known table (e.g. "competency" in "user_competency_progress")
      SELECT EXISTS(
        SELECT 1 FROM unnest(v_known_tables) t WHERE t LIKE '%' || v_table_ref.ref_table || '%'
      ) INTO v_is_substr;

      IF NOT v_is_substr THEN
        v_issues := v_issues || jsonb_build_object(
          'type', 'missing_table_reference',
          'entity', v_table_ref.ref_table,
          'context', format('Function %s references non-existent table/view: %s', p_func_name, v_table_ref.ref_table),
          'severity', 'critical'
        );
      END IF;
    END IF;
  END LOOP;

  -- Check table.column references
  FOR v_col_ref IN
    SELECT DISTINCT m[1] AS ref_table, m[2] AS ref_col
    FROM regexp_matches(
      v_func_body,
      '([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)',
      'gi'
    ) AS m
    WHERE lower(m[1]) != ALL(v_excluded_words)
    AND m[1] !~ '^v_'
    AND m[2] !~ '^v_'
    AND m[1] NOT IN ('auth', 'pg_proc', 'pg_namespace', 'information_schema', 'storage', 'public')
    AND m[2] NOT IN ('oid', 'nspname', 'proname', 'prosrc', 'uid')
  LOOP
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
