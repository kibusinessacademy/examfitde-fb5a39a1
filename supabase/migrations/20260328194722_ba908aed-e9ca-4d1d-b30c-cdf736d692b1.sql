
DROP FUNCTION IF EXISTS public.get_admin_auto_test_queue(int);

CREATE OR REPLACE VIEW public.v_admin_auto_test_queue_v2 AS
WITH latest_qa AS (
  SELECT DISTINCT ON (r.package_id)
    r.package_id, r.test_status, r.notes, r.issue_codes, r.created_at AS qa_created_at
  FROM public.admin_course_test_runs r
  ORDER BY r.package_id, r.created_at DESC
)
SELECT
  p.package_id, p.curriculum_id, p.title, p.test_priority, p.reason_codes,
  p.integrity_passed, p.council_approved, p.approved_questions, p.lessons_count, p.tutor_index_count,
  p.updated_at, p.published_at,
  q.test_status AS latest_qa_status, q.notes AS latest_qa_notes,
  q.issue_codes AS latest_qa_issue_codes, q.qa_created_at AS latest_qa_at,
  CASE WHEN q.qa_created_at IS NULL THEN true ELSE false END AS never_tested,
  CASE
    WHEN q.qa_created_at IS NULL THEN 'never_tested'
    WHEN q.qa_created_at >= now() - interval '1 day' THEN 'today'
    WHEN q.qa_created_at >= now() - interval '7 days' THEN 'recent'
    ELSE 'stale'
  END AS qa_freshness_bucket,
  CASE
    WHEN q.test_status = 'issue_found' AND q.qa_created_at >= now() - interval '7 days' THEN 120
    WHEN p.test_priority = 'critical' AND q.qa_created_at IS NULL THEN 115
    WHEN p.test_priority = 'critical' AND q.test_status = 'tested' THEN 110
    WHEN p.test_priority = 'critical' AND p.updated_at >= now() - interval '3 days' THEN 100
    WHEN p.test_priority = 'critical' THEN 90
    WHEN p.test_priority = 'warning' AND q.qa_created_at IS NULL THEN 85
    WHEN p.test_priority = 'warning' AND q.qa_created_at < now() - interval '14 days' THEN 80
    WHEN p.test_priority = 'warning' AND p.updated_at >= now() - interval '3 days' THEN 70
    WHEN p.test_priority = 'warning' THEN 60
    WHEN p.test_priority = 'healthy' AND q.qa_created_at IS NULL THEN 55
    WHEN p.test_priority = 'healthy' AND q.qa_created_at < now() - interval '21 days' THEN 50
    WHEN p.test_priority = 'healthy' AND p.updated_at >= now() - interval '3 days' THEN 40
    WHEN q.test_status = 'approved' AND q.qa_created_at >= now() - interval '7 days' THEN 10
    ELSE 20
  END AS queue_score
FROM public.v_admin_course_test_priority p
LEFT JOIN latest_qa q ON q.package_id = p.package_id
ORDER BY queue_score DESC, p.updated_at DESC NULLS LAST, p.published_at DESC NULLS LAST;

CREATE FUNCTION public.get_admin_auto_test_queue(p_limit int DEFAULT 10)
RETURNS TABLE (
  package_id uuid, curriculum_id uuid, title text, test_priority text,
  reason_codes text[], integrity_passed boolean, council_approved boolean,
  approved_questions bigint, lessons_count bigint, tutor_index_count bigint,
  updated_at timestamptz, published_at timestamptz,
  latest_qa_status text, latest_qa_notes text, latest_qa_issue_codes text[],
  latest_qa_at timestamptz, never_tested boolean, qa_freshness_bucket text, queue_score int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT q.package_id, q.curriculum_id, q.title, q.test_priority,
    q.reason_codes, q.integrity_passed, q.council_approved,
    q.approved_questions, q.lessons_count, q.tutor_index_count,
    q.updated_at, q.published_at,
    q.latest_qa_status, q.latest_qa_notes, q.latest_qa_issue_codes,
    q.latest_qa_at, q.never_tested, q.qa_freshness_bucket, q.queue_score
  FROM public.v_admin_auto_test_queue_v2 q
  ORDER BY q.queue_score DESC, q.updated_at DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit, 10), 1);
$$;

REVOKE ALL ON FUNCTION public.get_admin_auto_test_queue(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_auto_test_queue(int) TO authenticated, service_role;
