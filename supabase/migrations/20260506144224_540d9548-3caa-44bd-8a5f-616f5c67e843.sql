-- =====================================================================
-- LXI v1 Foundation: Schema-Drift-Guard + Audit-Harness + Phase 1 + 2
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.schema_contract_expectations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_key  text NOT NULL,
  table_schema  text NOT NULL DEFAULT 'public',
  table_name    text NOT NULL,
  column_name   text NOT NULL,
  expected_type text NOT NULL,
  is_required   boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_key, table_schema, table_name, column_name)
);
ALTER TABLE public.schema_contract_expectations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role full" ON public.schema_contract_expectations;
CREATE POLICY "service_role full" ON public.schema_contract_expectations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.schema_drift_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_key  text NOT NULL,
  run_at        timestamptz NOT NULL DEFAULT now(),
  drift_count   integer NOT NULL,
  blocked       boolean NOT NULL,
  drift_detail  jsonb NOT NULL DEFAULT '[]'::jsonb,
  triggered_by  text
);
ALTER TABLE public.schema_drift_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role full" ON public.schema_drift_audit;
CREATE POLICY "service_role full" ON public.schema_drift_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.fn_check_schema_drift(_contract_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_drift jsonb; v_count int;
BEGIN
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'table',  e.table_schema || '.' || e.table_name,
      'column', e.column_name,
      'expected', e.expected_type,
      'actual', c.data_type,
      'reason', CASE
        WHEN c.column_name IS NULL AND e.is_required THEN 'missing'
        WHEN c.data_type IS DISTINCT FROM e.expected_type THEN 'type_mismatch'
        ELSE NULL END
    )), '[]'::jsonb),
    COUNT(*) FILTER (WHERE
      (c.column_name IS NULL AND e.is_required)
      OR c.data_type IS DISTINCT FROM e.expected_type)
  INTO v_drift, v_count
  FROM public.schema_contract_expectations e
  LEFT JOIN information_schema.columns c
    ON c.table_schema = e.table_schema
   AND c.table_name   = e.table_name
   AND c.column_name  = e.column_name
  WHERE e.contract_key = _contract_key
    AND ((c.column_name IS NULL AND e.is_required)
         OR c.data_type IS DISTINCT FROM e.expected_type);

  RETURN jsonb_build_object(
    'contract_key', _contract_key,
    'drift_count', v_count,
    'blocked', v_count > 0,
    'detail', v_drift,
    'checked_at', now()
  );
END; $$;
REVOKE ALL ON FUNCTION public.fn_check_schema_drift(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_schema_drift(text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_check_schema_drift(_contract_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_result := public.fn_check_schema_drift(_contract_key);
  INSERT INTO public.schema_drift_audit(contract_key, drift_count, blocked, drift_detail, triggered_by)
  VALUES (_contract_key, (v_result->>'drift_count')::int, (v_result->>'blocked')::boolean,
          v_result->'detail', COALESCE(auth.uid()::text, 'service_role'));
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.admin_check_schema_drift(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_check_schema_drift(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_run_guarded_audit_repair(
  _contract_key text, _sql text, _dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_drift jsonb; v_err text;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_drift := public.fn_check_schema_drift(_contract_key);
  IF (v_drift->>'blocked')::boolean THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
    VALUES ('guarded_repair_blocked_by_drift','schema','blocked',
      jsonb_build_object('contract_key',_contract_key,'drift',v_drift));
    RETURN jsonb_build_object('status','blocked','reason','schema_drift','drift',v_drift);
  END IF;
  IF _dry_run THEN
    RETURN jsonb_build_object('status','dry_run_ok','contract_key',_contract_key);
  END IF;
  BEGIN
    EXECUTE _sql;
    INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
    VALUES ('guarded_repair_executed','schema','success', jsonb_build_object('contract_key',_contract_key));
    RETURN jsonb_build_object('status','executed','contract_key',_contract_key);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
    VALUES ('guarded_repair_failed_rolled_back','schema','error',
      jsonb_build_object('contract_key',_contract_key,'error',v_err));
    RAISE EXCEPTION 'guarded_repair_failed: %', v_err;
  END;
END; $$;
REVOKE ALL ON FUNCTION public.admin_run_guarded_audit_repair(text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_run_guarded_audit_repair(text,text,boolean) TO authenticated, service_role;

INSERT INTO public.schema_contract_expectations(contract_key, table_name, column_name, expected_type) VALUES
  ('lxi_v1','course_packages','id','uuid'),
  ('lxi_v1','course_packages','curriculum_id','uuid'),
  ('lxi_v1','course_packages','status','text'),
  ('lxi_v1','lessons','id','uuid'),
  ('lxi_v1','lessons','competency_id','uuid'),
  ('lxi_v1','competencies','id','uuid'),
  ('lxi_v1','competencies','learning_field_id','uuid'),
  ('lxi_v1','learning_fields','id','uuid'),
  ('lxi_v1','learning_fields','curriculum_id','uuid'),
  ('lxi_v1','minicheck_questions','id','uuid'),
  ('lxi_v1','minicheck_questions','curriculum_id','uuid'),
  ('lxi_v1','minicheck_questions','status','text'),
  ('lxi_v1','exam_questions','id','uuid'),
  ('lxi_v1','exam_questions','curriculum_id','uuid'),
  ('lxi_v1','exam_questions','competency_id','uuid'),
  ('lxi_v1','exam_questions','learning_field_id','uuid'),
  ('lxi_v1','exam_questions','canonical_hash','text'),
  ('lxi_v1','ai_tutor_context_index','package_id','uuid'),
  ('lxi_v1','oral_exam_blueprints','package_id','uuid'),
  ('lxi_v1','oral_exam_blueprints','status','text')
ON CONFLICT (contract_key, table_schema, table_name, column_name) DO NOTHING;

-- ---------------------------------------------------------------------
-- PHASE 1: LEARNING INTEGRITY AUDIT VIEW + RPC
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_learning_integrity_audit AS
WITH base AS (
  SELECT cp.id AS package_id, cp.package_key, cp.title, cp.curriculum_id, cp.status
  FROM public.course_packages cp
), counts AS (
  SELECT
    b.package_id, b.package_key, b.title, b.curriculum_id, b.status,
    (SELECT COUNT(*) FROM public.learning_fields lf WHERE lf.curriculum_id = b.curriculum_id) AS learningfield_count,
    (SELECT COUNT(*) FROM public.competencies c
       JOIN public.learning_fields lf ON lf.id = c.learning_field_id
       WHERE lf.curriculum_id = b.curriculum_id) AS competency_count,
    (SELECT COUNT(*) FROM public.lessons l
       JOIN public.competencies c ON c.id = l.competency_id
       JOIN public.learning_fields lf ON lf.id = c.learning_field_id
       WHERE lf.curriculum_id = b.curriculum_id) AS lesson_count,
    (SELECT COUNT(*) FROM public.minicheck_questions mc WHERE mc.curriculum_id = b.curriculum_id) AS minicheck_count,
    (SELECT COUNT(*) FROM public.ai_tutor_context_index t WHERE t.package_id = b.package_id) AS tutor_context_count,
    (SELECT COUNT(*) FROM public.oral_exam_blueprints ob WHERE ob.package_id = b.package_id) AS oral_blueprint_count,
    (SELECT COUNT(*) FROM public.exam_questions eq WHERE eq.curriculum_id = b.curriculum_id AND eq.status = 'approved') AS approved_exam_question_count,
    (SELECT COUNT(*) FROM public.exam_questions eq WHERE eq.curriculum_id = b.curriculum_id) AS total_exam_question_count,
    (SELECT (COUNT(*) - COUNT(DISTINCT eq.canonical_hash))
       FROM public.exam_questions eq
       WHERE eq.curriculum_id = b.curriculum_id AND eq.canonical_hash IS NOT NULL) AS duplicate_exam_question_count
  FROM base b
), coverage AS (
  SELECT c.*,
    CASE WHEN c.competency_count = 0 THEN 0
      ELSE ROUND(100.0 *
        (SELECT COUNT(DISTINCT eq.competency_id) FROM public.exam_questions eq
          WHERE eq.curriculum_id = c.curriculum_id AND eq.status='approved' AND eq.competency_id IS NOT NULL)
        / NULLIF(c.competency_count,0), 1) END AS competency_coverage_pct,
    CASE WHEN c.learningfield_count = 0 THEN 0
      ELSE ROUND(100.0 *
        (SELECT COUNT(DISTINCT eq.learning_field_id) FROM public.exam_questions eq
          WHERE eq.curriculum_id = c.curriculum_id AND eq.status='approved' AND eq.learning_field_id IS NOT NULL)
        / NULLIF(c.learningfield_count,0), 1) END AS blueprint_coverage_pct,
    CASE WHEN c.total_exam_question_count = 0 THEN 0
      ELSE ROUND(100.0 * c.duplicate_exam_question_count / NULLIF(c.total_exam_question_count,0), 1)
    END AS duplicate_question_ratio
  FROM counts c
), gates AS (
  SELECT cv.*,
    (cv.lesson_count = 0)                         AS gate_no_lessons,
    (cv.minicheck_count = 0)                      AS gate_no_minichecks,
    (cv.approved_exam_question_count < 50)        AS gate_low_exam_questions,
    (cv.oral_blueprint_count < 1)                 AS gate_no_oral,
    (cv.tutor_context_count = 0)                  AS gate_no_tutor_context,
    (cv.competency_coverage_pct < 80)             AS gate_low_competency_coverage,
    (cv.blueprint_coverage_pct < 80)              AS gate_low_blueprint_coverage,
    (cv.duplicate_question_ratio > 15)            AS gate_high_duplicates
  FROM coverage cv
)
SELECT g.*,
  GREATEST(0, 100
    - (CASE WHEN g.gate_no_lessons               THEN 25 ELSE 0 END)
    - (CASE WHEN g.gate_no_minichecks            THEN 15 ELSE 0 END)
    - (CASE WHEN g.gate_low_exam_questions       THEN 20 ELSE 0 END)
    - (CASE WHEN g.gate_no_oral                  THEN 10 ELSE 0 END)
    - (CASE WHEN g.gate_no_tutor_context         THEN 10 ELSE 0 END)
    - (CASE WHEN g.gate_low_competency_coverage  THEN 8  ELSE 0 END)
    - (CASE WHEN g.gate_low_blueprint_coverage   THEN 7  ELSE 0 END)
    - (CASE WHEN g.gate_high_duplicates          THEN 5  ELSE 0 END)
  ) AS learning_integrity_score,
  CASE
    WHEN g.gate_no_lessons OR g.gate_low_exam_questions OR g.gate_no_tutor_context THEN 'red'
    WHEN g.gate_no_minichecks OR g.gate_no_oral OR g.gate_low_competency_coverage
      OR g.gate_low_blueprint_coverage OR g.gate_high_duplicates THEN 'yellow'
    ELSE 'green'
  END AS publish_learning_status
FROM gates g;

REVOKE ALL ON public.v_learning_integrity_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_learning_integrity_audit TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_learning_integrity_audit(
  _status_filter text DEFAULT NULL, _published_only boolean DEFAULT true)
RETURNS SETOF public.v_learning_integrity_audit
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT * FROM public.v_learning_integrity_audit v
     WHERE (_published_only IS FALSE OR v.status = 'published')
       AND (_status_filter IS NULL OR v.publish_learning_status = _status_filter)
     ORDER BY
       CASE v.publish_learning_status WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END,
       v.learning_integrity_score ASC;
END; $$;
REVOKE ALL ON FUNCTION public.admin_get_learning_integrity_audit(text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_learning_integrity_audit(text,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_learning_integrity_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'published_total', COUNT(*) FILTER (WHERE status='published'),
    'green',  COUNT(*) FILTER (WHERE status='published' AND publish_learning_status='green'),
    'yellow', COUNT(*) FILTER (WHERE status='published' AND publish_learning_status='yellow'),
    'red',    COUNT(*) FILTER (WHERE status='published' AND publish_learning_status='red'),
    'top_gaps', (
      SELECT jsonb_build_object(
        'no_lessons',              COUNT(*) FILTER (WHERE gate_no_lessons),
        'no_minichecks',           COUNT(*) FILTER (WHERE gate_no_minichecks),
        'low_exam_questions',      COUNT(*) FILTER (WHERE gate_low_exam_questions),
        'no_oral',                 COUNT(*) FILTER (WHERE gate_no_oral),
        'no_tutor_context',        COUNT(*) FILTER (WHERE gate_no_tutor_context),
        'low_competency_coverage', COUNT(*) FILTER (WHERE gate_low_competency_coverage),
        'low_blueprint_coverage',  COUNT(*) FILTER (WHERE gate_low_blueprint_coverage),
        'high_duplicates',         COUNT(*) FILTER (WHERE gate_high_duplicates)
      )
      FROM public.v_learning_integrity_audit WHERE status='published'),
    'avg_score', ROUND(AVG(learning_integrity_score) FILTER (WHERE status='published'), 1),
    'computed_at', now()
  ) INTO v FROM public.v_learning_integrity_audit;
  RETURN v;
END; $$;
REVOKE ALL ON FUNCTION public.admin_get_learning_integrity_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_learning_integrity_summary() TO authenticated, service_role;