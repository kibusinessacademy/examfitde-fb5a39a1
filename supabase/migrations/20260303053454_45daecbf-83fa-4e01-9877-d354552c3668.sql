CREATE OR REPLACE FUNCTION public.get_next_hollow_lessons(
  p_package_id uuid,
  p_limit int DEFAULT 5
)
RETURNS TABLE(lesson_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id as lesson_id
  FROM lessons l
  JOIN modules m ON m.id = l.module_id
  JOIN courses c ON c.id = m.course_id
  JOIN course_packages cp ON cp.course_id = c.id
  WHERE cp.id = p_package_id
    AND (
      l.content::text ILIKE '%_placeholder%'
      OR length(COALESCE(l.content::text,'')) < 600
    )
  ORDER BY l.created_at ASC NULLS FIRST, l.id
  LIMIT GREATEST(1, LEAST(p_limit, 25));
$$;

REVOKE ALL ON FUNCTION public.get_next_hollow_lessons(uuid,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_hollow_lessons(uuid,int) TO service_role;
