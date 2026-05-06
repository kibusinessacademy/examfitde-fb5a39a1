DROP FUNCTION IF EXISTS public.admin_get_learning_integrity_audit(text, boolean) CASCADE;
DROP VIEW IF EXISTS public.v_learning_integrity_audit;

CREATE VIEW public.v_learning_integrity_audit AS
WITH base AS (
  SELECT cp.id AS package_id, cp.package_key, cp.title, cp.curriculum_id, cp.status
  FROM course_packages cp
),
approved_q AS (
  SELECT b.package_id, eq.canonical_hash,
         COALESCE(eq.variant_group::text, '__novg__') AS vg_bucket
  FROM base b
  JOIN exam_questions eq
    ON eq.curriculum_id = b.curriculum_id
   AND eq.status = 'approved'::question_status
   AND eq.canonical_hash IS NOT NULL
),
dup_groups AS (
  SELECT package_id, canonical_hash, vg_bucket, COUNT(*) AS n
  FROM approved_q GROUP BY 1,2,3
),
dup_agg AS (
  SELECT package_id,
         SUM(n) AS approved_with_hash,
         SUM(GREATEST(n - 1, 0)) AS surplus_dup_rows
  FROM dup_groups GROUP BY 1
),
counts AS (
  SELECT b.package_id, b.package_key, b.title, b.curriculum_id, b.status,
    (SELECT COUNT(*) FROM learning_fields lf WHERE lf.curriculum_id=b.curriculum_id) AS learningfield_count,
    (SELECT COUNT(*) FROM competencies c JOIN learning_fields lf ON lf.id=c.learning_field_id WHERE lf.curriculum_id=b.curriculum_id) AS competency_count,
    (SELECT COUNT(*) FROM lessons l JOIN competencies c ON c.id=l.competency_id JOIN learning_fields lf ON lf.id=c.learning_field_id WHERE lf.curriculum_id=b.curriculum_id) AS lesson_count,
    (SELECT COUNT(*) FROM minicheck_questions mc WHERE mc.curriculum_id=b.curriculum_id) AS minicheck_count,
    (SELECT COUNT(*) FROM ai_tutor_context_index t WHERE t.package_id=b.package_id) AS tutor_context_count,
    (SELECT COUNT(*) FROM oral_exam_blueprints ob WHERE ob.package_id=b.package_id) AS oral_blueprint_count,
    (SELECT COUNT(*) FROM exam_questions eq WHERE eq.curriculum_id=b.curriculum_id AND eq.status='approved'::question_status) AS approved_exam_question_count,
    (SELECT COUNT(*) FROM exam_questions eq WHERE eq.curriculum_id=b.curriculum_id) AS total_exam_question_count,
    COALESCE((SELECT surplus_dup_rows FROM dup_agg da WHERE da.package_id=b.package_id), 0) AS duplicate_exam_question_count,
    COALESCE((SELECT approved_with_hash FROM dup_agg da WHERE da.package_id=b.package_id), 0) AS approved_with_hash_count
  FROM base b
),
coverage AS (
  SELECT c.*,
    CASE WHEN c.competency_count=0 THEN 0::numeric
         ELSE ROUND(100.0 * (SELECT COUNT(DISTINCT eq.competency_id) FROM exam_questions eq
                             WHERE eq.curriculum_id=c.curriculum_id AND eq.status='approved'::question_status AND eq.competency_id IS NOT NULL)::numeric
                  / NULLIF(c.competency_count,0)::numeric, 1)
    END AS competency_coverage_pct,
    CASE WHEN c.learningfield_count=0 THEN 0::numeric
         ELSE ROUND(100.0 * (SELECT COUNT(DISTINCT eq.learning_field_id) FROM exam_questions eq
                             WHERE eq.curriculum_id=c.curriculum_id AND eq.status='approved'::question_status AND eq.learning_field_id IS NOT NULL)::numeric
                  / NULLIF(c.learningfield_count,0)::numeric, 1)
    END AS blueprint_coverage_pct,
    CASE WHEN c.approved_with_hash_count=0 THEN 0::numeric
         ELSE ROUND(100.0 * c.duplicate_exam_question_count::numeric / NULLIF(c.approved_with_hash_count,0)::numeric, 1)
    END AS duplicate_question_ratio
  FROM counts c
),
gates AS (
  SELECT cv.*,
    cv.lesson_count = 0 AS gate_no_lessons,
    cv.minicheck_count = 0 AS gate_no_minichecks,
    cv.approved_exam_question_count < 50 AS gate_low_exam_questions,
    cv.oral_blueprint_count < 1 AS gate_no_oral,
    cv.tutor_context_count = 0 AS gate_no_tutor_context,
    cv.competency_coverage_pct < 80::numeric AS gate_low_competency_coverage,
    cv.blueprint_coverage_pct < 80::numeric AS gate_low_blueprint_coverage,
    cv.duplicate_question_ratio > 15::numeric AS gate_high_duplicates
  FROM coverage cv
)
SELECT package_id, package_key, title, curriculum_id, status,
  learningfield_count, competency_count, lesson_count, minicheck_count,
  tutor_context_count, oral_blueprint_count, approved_exam_question_count,
  total_exam_question_count, duplicate_exam_question_count,
  competency_coverage_pct, blueprint_coverage_pct, duplicate_question_ratio,
  gate_no_lessons, gate_no_minichecks, gate_low_exam_questions, gate_no_oral,
  gate_no_tutor_context, gate_low_competency_coverage, gate_low_blueprint_coverage,
  gate_high_duplicates,
  GREATEST(0, 100
    - CASE WHEN gate_no_lessons THEN 25 ELSE 0 END
    - CASE WHEN gate_no_minichecks THEN 15 ELSE 0 END
    - CASE WHEN gate_low_exam_questions THEN 20 ELSE 0 END
    - CASE WHEN gate_no_oral THEN 10 ELSE 0 END
    - CASE WHEN gate_no_tutor_context THEN 10 ELSE 0 END
    - CASE WHEN gate_low_competency_coverage THEN 8 ELSE 0 END
    - CASE WHEN gate_low_blueprint_coverage THEN 7 ELSE 0 END
    - CASE WHEN gate_high_duplicates THEN 5 ELSE 0 END
  ) AS learning_integrity_score,
  CASE
    WHEN gate_no_lessons OR gate_low_exam_questions OR gate_no_tutor_context THEN 'red'::text
    WHEN gate_no_minichecks OR gate_no_oral OR gate_low_competency_coverage OR gate_low_blueprint_coverage OR gate_high_duplicates THEN 'yellow'::text
    ELSE 'green'::text
  END AS publish_learning_status
FROM gates;

REVOKE ALL ON public.v_learning_integrity_audit FROM PUBLIC;
GRANT SELECT ON public.v_learning_integrity_audit TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_learning_integrity_audit(_status_filter text DEFAULT NULL::text, _published_only boolean DEFAULT true)
RETURNS SETOF public.v_learning_integrity_audit
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT * FROM public.v_learning_integrity_audit v
     WHERE (_published_only IS FALSE OR v.status = 'published')
       AND (_status_filter IS NULL OR v.publish_learning_status = _status_filter)
     ORDER BY
       CASE v.publish_learning_status WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END,
       v.learning_integrity_score ASC;
END; $function$;

REVOKE ALL ON FUNCTION public.admin_get_learning_integrity_audit(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_learning_integrity_audit(text, boolean) TO authenticated, service_role;