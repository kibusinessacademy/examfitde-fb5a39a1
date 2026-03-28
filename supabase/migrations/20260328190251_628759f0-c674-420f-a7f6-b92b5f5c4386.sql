
CREATE OR REPLACE VIEW public.v_admin_published_course_preview AS
WITH approved_question_counts AS (
  SELECT
    eq.curriculum_id,
    COUNT(*) FILTER (WHERE eq.status = 'approved') AS approved_questions
  FROM public.exam_questions eq
  GROUP BY eq.curriculum_id
),
lesson_counts AS (
  SELECT
    c.curriculum_id,
    COUNT(l.id) AS lessons_count
  FROM public.courses c
  JOIN public.modules m ON m.course_id = c.id
  JOIN public.lessons l ON l.module_id = m.id
  GROUP BY c.curriculum_id
),
tutor_index_counts AS (
  SELECT
    package_id,
    COUNT(*) AS tutor_index_count
  FROM public.ai_tutor_context_index
  GROUP BY package_id
)
SELECT
  cp.id AS package_id,
  cp.curriculum_id,
  cp.title,
  cp.status,
  cp.integrity_passed,
  cp.council_approved,
  COALESCE(aqc.approved_questions, 0)::int AS approved_questions,
  COALESCE(lc.lessons_count, 0)::int AS lessons_count,
  COALESCE(tic.tutor_index_count, 0)::int AS tutor_index_count,
  cp.updated_at,
  cp.published_at
FROM public.course_packages cp
LEFT JOIN approved_question_counts aqc ON aqc.curriculum_id = cp.curriculum_id
LEFT JOIN lesson_counts lc ON lc.curriculum_id = cp.curriculum_id
LEFT JOIN tutor_index_counts tic ON tic.package_id = cp.id
WHERE cp.status = 'published';

GRANT SELECT ON public.v_admin_published_course_preview TO service_role;

CREATE OR REPLACE FUNCTION public.get_admin_published_course_preview()
RETURNS SETOF public.v_admin_published_course_preview
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.v_admin_published_course_preview
  ORDER BY published_at DESC NULLS LAST, updated_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_admin_published_course_preview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_published_course_preview() TO authenticated, service_role;
