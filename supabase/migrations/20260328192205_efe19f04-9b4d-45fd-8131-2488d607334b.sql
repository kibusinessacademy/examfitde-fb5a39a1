
CREATE OR REPLACE VIEW public.v_admin_course_test_priority AS
SELECT
  p.package_id,
  p.curriculum_id,
  p.title,
  p.status,
  p.integrity_passed,
  p.council_approved,
  p.approved_questions,
  p.lessons_count,
  p.tutor_index_count,
  p.updated_at,
  p.published_at,
  CASE
    WHEN COALESCE(p.integrity_passed, false) = false THEN 'critical'
    WHEN COALESCE(p.council_approved, false) = false THEN 'critical'
    WHEN COALESCE(p.approved_questions, 0) < 40 THEN 'critical'
    WHEN COALESCE(p.lessons_count, 0) = 0 THEN 'critical'
    WHEN COALESCE(p.approved_questions, 0) < 100 THEN 'warning'
    WHEN COALESCE(p.lessons_count, 0) < 5 THEN 'warning'
    WHEN COALESCE(p.tutor_index_count, 0) = 0 THEN 'warning'
    ELSE 'healthy'
  END AS test_priority,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN COALESCE(p.integrity_passed, false) = false THEN 'integrity_failed' END,
    CASE WHEN COALESCE(p.council_approved, false) = false THEN 'council_not_approved' END,
    CASE WHEN COALESCE(p.approved_questions, 0) < 40 THEN 'too_few_questions' END,
    CASE WHEN COALESCE(p.lessons_count, 0) = 0 THEN 'no_lessons' END,
    CASE WHEN COALESCE(p.approved_questions, 0) >= 40 AND COALESCE(p.approved_questions, 0) < 100 THEN 'low_question_buffer' END,
    CASE WHEN COALESCE(p.lessons_count, 0) > 0 AND COALESCE(p.lessons_count, 0) < 5 THEN 'low_lesson_count' END,
    CASE WHEN COALESCE(p.tutor_index_count, 0) = 0 THEN 'missing_tutor_index' END
  ], NULL) AS reason_codes
FROM public.v_admin_published_course_preview p;

CREATE OR REPLACE FUNCTION public.get_admin_course_test_priority()
RETURNS SETOF public.v_admin_course_test_priority
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.v_admin_course_test_priority
  ORDER BY
    CASE test_priority
      WHEN 'critical' THEN 1
      WHEN 'warning' THEN 2
      ELSE 3
    END,
    updated_at DESC NULLS LAST,
    published_at DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.get_admin_course_test_priority() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_course_test_priority() TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_admin_auto_test_queue AS
SELECT
  p.package_id,
  p.curriculum_id,
  p.title,
  p.test_priority,
  p.reason_codes,
  p.integrity_passed,
  p.council_approved,
  p.approved_questions,
  p.lessons_count,
  p.tutor_index_count,
  p.updated_at,
  p.published_at,
  CASE
    WHEN p.test_priority = 'critical' AND p.updated_at >= now() - interval '3 days' THEN 100
    WHEN p.test_priority = 'critical' THEN 90
    WHEN p.test_priority = 'warning' AND p.updated_at >= now() - interval '3 days' THEN 70
    WHEN p.test_priority = 'warning' THEN 60
    WHEN p.test_priority = 'healthy' AND p.updated_at >= now() - interval '3 days' THEN 40
    ELSE 20
  END AS queue_score,
  CASE
    WHEN p.updated_at >= now() - interval '1 day' THEN 'today'
    WHEN p.updated_at >= now() - interval '3 days' THEN 'recent'
    ELSE 'older'
  END AS freshness_bucket
FROM public.v_admin_course_test_priority p;

CREATE OR REPLACE FUNCTION public.get_admin_auto_test_queue(
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  package_id uuid,
  curriculum_id uuid,
  title text,
  test_priority text,
  reason_codes text[],
  integrity_passed boolean,
  council_approved boolean,
  approved_questions bigint,
  lessons_count bigint,
  tutor_index_count bigint,
  updated_at timestamptz,
  published_at timestamptz,
  queue_score int,
  freshness_bucket text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    q.package_id,
    q.curriculum_id,
    q.title,
    q.test_priority,
    q.reason_codes,
    q.integrity_passed,
    q.council_approved,
    q.approved_questions,
    q.lessons_count,
    q.tutor_index_count,
    q.updated_at,
    q.published_at,
    q.queue_score,
    q.freshness_bucket
  FROM public.v_admin_auto_test_queue q
  ORDER BY q.queue_score DESC, q.updated_at DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit, 10), 1);
$$;

REVOKE ALL ON FUNCTION public.get_admin_auto_test_queue(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_auto_test_queue(int) TO authenticated, service_role;
