-- SSOT View: exam-relevant questions (excludes rejected + tier1_failed)
-- Used by: fan-out counting, post-conditions, drift-finder, auto-publish, reconcile
CREATE OR REPLACE VIEW public.v_exam_relevant_questions AS
SELECT *
FROM exam_questions
WHERE status != 'rejected'
  AND qc_status NOT IN ('tier1_failed', 'rejected');

-- SSOT counting RPC: single source for "how many exam-relevant questions?"
CREATE OR REPLACE FUNCTION public.count_exam_relevant(
  p_curriculum_id uuid,
  p_learning_field_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)
  FROM v_exam_relevant_questions
  WHERE curriculum_id = p_curriculum_id
    AND (p_learning_field_id IS NULL OR learning_field_id = p_learning_field_id);
$$;

-- Update get_exam_question_counts_by_lf to use the view
CREATE OR REPLACE FUNCTION public.get_exam_question_counts_by_lf(
  p_curriculum_id uuid,
  p_lf_ids uuid[]
)
RETURNS TABLE(learning_field_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.learning_field_id, count(*) AS cnt
  FROM v_exam_relevant_questions v
  WHERE v.curriculum_id = p_curriculum_id
    AND v.learning_field_id = ANY(p_lf_ids)
  GROUP BY v.learning_field_id;
$$;

-- Update ops_drift_finder to use exam-relevant count
DROP VIEW IF EXISTS public.ops_drift_finder;
CREATE VIEW public.ops_drift_finder AS

SELECT 
  'false_done_exam_pool' AS drift_type,
  cp.id AS package_id,
  cp.title,
  cp.status::text AS package_status,
  ps.step_key,
  ps.status::text AS step_status,
  jsonb_build_object(
    'exam_target', 500,
    'actual_count', (SELECT count(*) FROM v_exam_relevant_questions eq WHERE eq.curriculum_id = cp.curriculum_id),
    'shortfall', 500 - (SELECT count(*) FROM v_exam_relevant_questions eq WHERE eq.curriculum_id = cp.curriculum_id)
  ) AS detail
FROM course_packages cp
JOIN package_steps ps ON ps.package_id = cp.id
WHERE ps.step_key = 'generate_exam_pool'
  AND ps.status = 'done'
  AND cp.status NOT IN ('archived', 'superseded')
  AND cp.track = 'AUSBILDUNG_VOLL'
  AND (SELECT count(*) FROM v_exam_relevant_questions eq WHERE eq.curriculum_id = cp.curriculum_id) < 500

UNION ALL

SELECT 
  'stale_integrity_report' AS drift_type,
  cp.id AS package_id,
  cp.title,
  cp.status::text AS package_status,
  'run_integrity_check' AS step_key,
  COALESCE(ps.status::text, 'n/a') AS step_status,
  jsonb_build_object(
    'report_version_num', cp.integrity_report_version_num,
    'required_min', 15
  ) AS detail
FROM course_packages cp
LEFT JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key = 'run_integrity_check'
WHERE cp.status NOT IN ('archived', 'superseded')
  AND cp.track = 'AUSBILDUNG_VOLL'
  AND COALESCE(cp.integrity_report_version_num, 0) < 15
  AND cp.integrity_report IS NOT NULL;