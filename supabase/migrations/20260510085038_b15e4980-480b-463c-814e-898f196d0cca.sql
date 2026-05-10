-- Read-only diagnostic for lesson-join parity (regression-test backbone).
-- Returns one row per published package where the curriculum-path and the
-- direct course_id-path lesson counts disagree.

CREATE OR REPLACE FUNCTION public.admin_check_lesson_join_parity(
  p_status text DEFAULT 'published',
  p_limit  integer DEFAULT 500
)
RETURNS TABLE (
  package_id          uuid,
  title               text,
  curriculum_id       uuid,
  course_id           uuid,
  via_curriculum      bigint,
  via_package_course  bigint,
  delta               bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pkg AS (
    SELECT cp.id, cp.title, cp.curriculum_id, cp.course_id
    FROM course_packages cp
    WHERE (p_status IS NULL OR cp.status::text = p_status)
    LIMIT p_limit
  ),
  via_curr AS (
    SELECT p.id AS package_id, COUNT(l.id) AS n
    FROM pkg p
    LEFT JOIN courses  c ON c.curriculum_id = p.curriculum_id
    LEFT JOIN modules  m ON m.course_id = c.id
    LEFT JOIN lessons  l ON l.module_id = m.id
    GROUP BY p.id
  ),
  via_course AS (
    SELECT p.id AS package_id, COUNT(l.id) AS n
    FROM pkg p
    LEFT JOIN modules m ON m.course_id = p.course_id
    LEFT JOIN lessons l ON l.module_id = m.id
    GROUP BY p.id
  )
  SELECT
    p.id, p.title, p.curriculum_id, p.course_id,
    vc.n, vp.n, (vc.n - vp.n)
  FROM pkg p
  JOIN via_curr   vc ON vc.package_id = p.id
  JOIN via_course vp ON vp.package_id = p.id
  WHERE COALESCE(public.has_role(auth.uid(), 'admin'), false)
    AND vc.n <> vp.n
  ORDER BY abs(vc.n - vp.n) DESC, p.title
$$;

REVOKE ALL ON FUNCTION public.admin_check_lesson_join_parity(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_check_lesson_join_parity(text, integer) TO authenticated;