
-- Must drop first due to parameter name change
DROP FUNCTION IF EXISTS public.check_production_quality(uuid, uuid);

CREATE FUNCTION public.check_production_quality(p_package_id uuid, p_curriculum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INTEGER;
  v_dup_count INTEGER;
  v_dup_rate NUMERIC(5,2);
  v_lf_coverage NUMERIC(5,2);
  v_easy_pct NUMERIC(5,2);
  v_medium_pct NUMERIC(5,2);
  v_hard_pct NUMERIC(5,2);
  v_low_conf INTEGER;
  v_flags TEXT[] := '{}';
  v_pause BOOLEAN := false;
  v_pause_reason TEXT;
  v_lf_detail JSONB := '{}';
  v_confidence INTEGER := 100;
  v_governance INTEGER := 100;
  v_force_resume_count INTEGER;
  v_manual_review_pct NUMERIC(5,2);
  v_provider_drift NUMERIC(5,2);
  v_days_since_audit INTEGER;
BEGIN
  SELECT count(*) INTO v_total
  FROM exam_questions eq
  JOIN exam_blueprints eb ON eq.blueprint_id = eb.id
  WHERE eb.curriculum_id = p_curriculum_id;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('total', 0, 'status', 'no_questions');
  END IF;

  SELECT count(*) INTO v_dup_count
  FROM duplicate_detection_log WHERE package_id = p_package_id;
  v_dup_rate := ROUND(100.0 * v_dup_count / v_total, 2);

  SELECT
    ROUND(100.0 * count(*) FILTER (WHERE difficulty = 'easy') / count(*), 1),
    ROUND(100.0 * count(*) FILTER (WHERE difficulty = 'medium') / count(*), 1),
    ROUND(100.0 * count(*) FILTER (WHERE difficulty = 'hard') / count(*), 1)
  INTO v_easy_pct, v_medium_pct, v_hard_pct
  FROM exam_questions eq
  JOIN exam_blueprints eb ON eq.blueprint_id = eb.id
  WHERE eb.curriculum_id = p_curriculum_id;

  -- FIXED: lernfelder → learning_fields, lernfeld_id → learning_field_id
  SELECT ROUND(100.0 * count(DISTINCT eq.learning_field_id) /
    GREATEST(1, (SELECT count(DISTINCT id) FROM learning_fields WHERE curriculum_id = p_curriculum_id)), 1)
  INTO v_lf_coverage
  FROM exam_questions eq
  JOIN exam_blueprints eb ON eq.blueprint_id = eb.id
  WHERE eb.curriculum_id = p_curriculum_id AND eq.learning_field_id IS NOT NULL;

  -- FIXED: bezeichnung → title
  SELECT jsonb_object_agg(lf_name, jsonb_build_object(
    'count', cnt, 'pct', ROUND(100.0 * cnt / v_total, 1),
    'target_pct', ROUND(100.0 / GREATEST(1, lf_total), 1),
    'deviation', ABS(ROUND(100.0 * cnt / v_total - 100.0 / GREATEST(1, lf_total), 1))
  )) INTO v_lf_detail
  FROM (
    SELECT l.title AS lf_name, count(eq.id) AS cnt,
           (SELECT count(DISTINCT id) FROM learning_fields WHERE curriculum_id = p_curriculum_id) AS lf_total
    FROM exam_questions eq
    JOIN exam_blueprints eb ON eq.blueprint_id = eb.id
    LEFT JOIN learning_fields l ON eq.learning_field_id = l.id
    WHERE eb.curriculum_id = p_curriculum_id AND eq.learning_field_id IS NOT NULL
    GROUP BY l.title, lf_total
  ) sub;

  SELECT count(*) INTO v_low_conf
  FROM exam_questions eq
  JOIN exam_blueprints eb ON eq.blueprint_id = eb.id
  WHERE eb.curriculum_id = p_curriculum_id
    AND (eq.metadata->>'confidence_score')::numeric < 0.6;

  IF v_dup_rate > 3 THEN v_flags := array_append(v_flags, 'high_duplicate_rate'); END IF;
  IF v_dup_rate > 4.5 THEN v_pause := true; v_pause_reason := 'Duplikat-Rate > 4.5%'; END IF;
  IF v_lf_coverage < 80 THEN v_flags := array_append(v_flags, 'low_lf_coverage'); END IF;
  IF v_lf_coverage < 70 THEN v_pause := true; v_pause_reason := COALESCE(v_pause_reason || ' + ', '') || 'LF-Coverage < 70%'; END IF;
  IF v_hard_pct < 15 THEN v_flags := array_append(v_flags, 'low_hard_ratio'); END IF;
  IF v_hard_pct < 10 THEN v_pause := true; v_pause_reason := COALESCE(v_pause_reason || ' + ', '') || 'Hard-Anteil < 10%'; END IF;
  IF v_low_conf > v_total * 0.15 THEN v_flags := array_append(v_flags, 'high_low_confidence'); END IF;

  v_confidence := GREATEST(0, LEAST(100,
    ROUND(
      0.35 * LEAST(100, v_lf_coverage) +
      0.25 * GREATEST(0, 100 - v_dup_rate * 20) +
      0.20 * CASE WHEN v_hard_pct BETWEEN 15 AND 30 AND v_easy_pct BETWEEN 30 AND 50 THEN 100
                   WHEN v_hard_pct >= 10 THEN 70 ELSE 30 END +
      0.10 * 85 +
      0.10 * GREATEST(0, 100 - (v_low_conf::numeric / GREATEST(1, v_total) * 500))
    )
  ));

  SELECT count(*) INTO v_force_resume_count
  FROM quality_audit_snapshots WHERE package_id = p_package_id AND event_type = 'force_resume';

  SELECT COALESCE(EXTRACT(DAY FROM now() - MAX(created_at))::integer, 999) INTO v_days_since_audit
  FROM quality_audit_snapshots WHERE package_id = p_package_id;

  SELECT COALESCE(MAX(
    CASE WHEN total_calls > 0 THEN ROUND(100.0 * error_count / total_calls, 1) ELSE 0 END
  ), 0) INTO v_provider_drift
  FROM provider_performance WHERE date >= (CURRENT_DATE - 3);

  v_governance := GREATEST(0, LEAST(100,
    100 - v_force_resume_count * 8
    - CASE WHEN v_days_since_audit > 14 THEN 15 WHEN v_days_since_audit > 7 THEN 5 ELSE 0 END
    - CASE WHEN v_provider_drift > 20 THEN 20 WHEN v_provider_drift > 10 THEN 10 ELSE 0 END
  ));

  IF v_pause THEN
    UPDATE course_packages SET status = 'quality_hold'
    WHERE id = p_package_id AND status = 'building';
  END IF;

  INSERT INTO production_quality_snapshots (
    package_id, total_questions, duplicate_rate, lf_coverage_pct,
    difficulty_easy_pct, difficulty_medium_pct, difficulty_hard_pct,
    low_confidence_count, confidence_score, governance_score,
    lf_detail, flags, auto_paused, pause_reason
  ) VALUES (
    p_package_id, v_total, v_dup_rate, v_lf_coverage,
    v_easy_pct, v_medium_pct, v_hard_pct,
    v_low_conf, v_confidence, v_governance,
    v_lf_detail, v_flags, v_pause, v_pause_reason
  );

  IF v_pause OR v_confidence >= 85 OR v_total % 200 < 10 THEN
    INSERT INTO quality_audit_snapshots (
      package_id, event_type, triggered_by, trigger_reason,
      question_count, lf_coverage_pct, duplicate_rate, hard_ratio,
      low_confidence_ratio, confidence_score, governance_score, snapshot_data
    ) VALUES (
      p_package_id,
      CASE WHEN v_pause THEN 'quality_hold' WHEN v_confidence >= 85 THEN 'confidence_pass' ELSE 'periodic_audit' END,
      'system',
      CASE WHEN v_pause THEN v_pause_reason ELSE 'Routine check at ' || v_total || ' questions' END,
      v_total, v_lf_coverage, v_dup_rate, v_hard_pct,
      ROUND(100.0 * v_low_conf / GREATEST(1, v_total), 1),
      v_confidence, v_governance,
      jsonb_build_object('flags', v_flags, 'lf_detail', v_lf_detail, 'difficulty', jsonb_build_object('easy', v_easy_pct, 'medium', v_medium_pct, 'hard', v_hard_pct))
    );
  END IF;

  RETURN jsonb_build_object(
    'total', v_total, 'duplicate_rate', v_dup_rate, 'lf_coverage', v_lf_coverage,
    'difficulty', jsonb_build_object('easy', v_easy_pct, 'medium', v_medium_pct, 'hard', v_hard_pct),
    'low_confidence', v_low_conf, 'confidence_score', v_confidence,
    'governance_score', v_governance, 'flags', to_jsonb(v_flags),
    'paused', v_pause, 'pause_reason', v_pause_reason
  );
END;
$$;

-- Also update validate_function_references with CTE + pg_catalog handling
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
    'lc', 'comp', 'lf', 'ucp', 'src', 'cur', 'elem', 'sub'
  ];
  v_pg_catalog_tables text[] := ARRAY[
    'pg_proc', 'pg_namespace', 'pg_class', 'pg_trigger', 'pg_tables',
    'pg_policies', 'pg_event_trigger', 'pg_depend', 'pg_type',
    'pg_attribute', 'pg_index', 'pg_constraint', 'pg_stat_activity',
    'pg_event_trigger_ddl_commands'
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
            'context', format('Function %s references non-existent table/view: %s', p_func_name, v_table_ref.ref_table),
            'severity', 'critical'
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

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

  RETURN jsonb_build_object(
    'function', p_func_name,
    'status', CASE WHEN jsonb_array_length(v_issues) = 0 THEN 'clean' ELSE 'drift_detected' END,
    'issue_count', jsonb_array_length(v_issues),
    'checked_at', now(), 'issues', v_issues
  );
END;
$$;
