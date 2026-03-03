-- SSOT RPC: package_lessons_realness
-- Used by Runner post-condition guard, IntegrityBuilder, PublishGuard
CREATE OR REPLACE FUNCTION public.package_lessons_realness(p_package_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'lessons_total', COUNT(*)::int,
    'real_content', COUNT(*) FILTER (WHERE length(COALESCE(l.content::text,'')) > 1200)::int,
    'placeholders', COUNT(*) FILTER (WHERE l.content::text ILIKE '%_placeholder%')::int,
    'emptyish', COUNT(*) FILTER (WHERE length(COALESCE(l.content::text,'')) < 100)::int,
    'avg_len', COALESCE(AVG(length(COALESCE(l.content::text,'')))::int, 0)
  )
  FROM lessons l
  JOIN modules m ON m.id = l.module_id
  JOIN courses c ON c.id = m.course_id
  JOIN course_packages cp ON cp.course_id = c.id
  WHERE cp.id = p_package_id;
$$;

-- Lock down to service_role only
REVOKE ALL ON FUNCTION public.package_lessons_realness(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.package_lessons_realness(uuid) TO service_role;