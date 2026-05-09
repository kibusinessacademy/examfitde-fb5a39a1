
CREATE OR REPLACE FUNCTION public.admin_get_oral_seed_diagnostics(p_package_id uuid DEFAULT NULL)
RETURNS TABLE(
  package_id uuid,
  title text,
  status text,
  track text,
  curriculum_id uuid,
  approved_questions int,
  exam_blueprints int,
  learning_fields int,
  competencies int,
  oral_blueprints int,
  generate_oral_exam_status text,
  generate_oral_exam_last_error text,
  has_pending_seed_job boolean,
  eligibility text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT cp.id, cp.title, cp.status, cp.track, cp.curriculum_id
    FROM public.course_packages cp
    WHERE (p_package_id IS NULL OR cp.id = p_package_id)
      AND cp.status IN ('building','queued','blocked','published')
  ),
  agg AS (
    SELECT
      b.id AS package_id,
      b.title, b.status, b.track::text AS track, b.curriculum_id,
      COALESCE((SELECT count(*)::int FROM public.exam_questions eq WHERE eq.package_id = b.id AND eq.status = 'approved'),0) AS approved_questions,
      COALESCE((SELECT count(*)::int FROM public.exam_blueprints xb WHERE xb.package_id = b.id),0) AS exam_blueprints,
      COALESCE((SELECT count(*)::int FROM public.learning_fields lf WHERE lf.curriculum_id = b.curriculum_id),0) AS learning_fields,
      COALESCE((SELECT count(*)::int FROM public.competencies c JOIN public.learning_fields lf ON lf.id = c.learning_field_id WHERE lf.curriculum_id = b.curriculum_id),0) AS competencies,
      COALESCE((SELECT count(*)::int FROM public.oral_exam_blueprints ob WHERE ob.curriculum_id = b.curriculum_id),0) AS oral_blueprints,
      (SELECT ps.status FROM public.package_steps ps WHERE ps.package_id = b.id AND ps.step_key = 'generate_oral_exam' LIMIT 1) AS generate_oral_exam_status,
      (SELECT ps.last_error FROM public.package_steps ps WHERE ps.package_id = b.id AND ps.step_key = 'generate_oral_exam' LIMIT 1) AS generate_oral_exam_last_error,
      EXISTS(SELECT 1 FROM public.job_queue jq WHERE jq.package_id = b.id AND jq.job_type = 'package_seed_oral_blueprints' AND jq.status IN ('pending','processing','retry')) AS has_pending_seed_job
    FROM base b
  )
  SELECT
    a.package_id, a.title, a.status, a.track, a.curriculum_id,
    a.approved_questions, a.exam_blueprints, a.learning_fields, a.competencies, a.oral_blueprints,
    a.generate_oral_exam_status, a.generate_oral_exam_last_error, a.has_pending_seed_job,
    CASE
      WHEN a.oral_blueprints > 0 THEN 'SKIP_HAS_ORAL'
      WHEN a.learning_fields = 0 THEN 'BLOCKED_NO_LEARNING_FIELDS'
      WHEN a.exam_blueprints < 10 AND a.approved_questions < 50 THEN 'BLOCKED_FEW_QUESTIONS'
      ELSE 'READY'
    END AS eligibility,
    CASE
      WHEN a.oral_blueprints > 0 THEN 'Already has ' || a.oral_blueprints::text || ' oral blueprints'
      WHEN a.learning_fields = 0 THEN 'No learning_fields for curriculum'
      WHEN a.exam_blueprints < 10 AND a.approved_questions < 50 THEN 'Need ≥10 exam_blueprints OR ≥50 approved questions (have ' || a.exam_blueprints::text || ' / ' || a.approved_questions::text || ')'
      ELSE 'All preconditions met — seed job can run'
    END AS reason
  FROM agg a
  ORDER BY (CASE WHEN a.oral_blueprints = 0 AND a.learning_fields > 0 THEN 0 ELSE 1 END), a.title;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_oral_seed_diagnostics(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_oral_seed_diagnostics(uuid) TO authenticated, service_role;
