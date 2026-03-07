
-- ══════════════════════════════════════════════════════════════
-- SSOT DRIFT AUDIT FIX: Align all placeholder/hollow RPCs
-- with scheduler scope (exclude mini_check, use JSON field check)
-- ══════════════════════════════════════════════════════════════

-- Fix 1: check_no_placeholder_lessons — used by exam-pool guard
-- ADD mini_check exclusion
CREATE OR REPLACE FUNCTION public.check_no_placeholder_lessons(p_course_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  placeholder_count integer;
BEGIN
  SELECT count(*) INTO placeholder_count
  FROM lessons l
  JOIN modules m ON l.module_id = m.id
  WHERE m.course_id = p_course_id
    AND l.step != 'mini_check'
    AND (
      l.content IS NULL 
      OR l.content->>'_placeholder' = 'true'
      OR length(COALESCE(l.content->>'html', '')) < 100
    );
  
  RETURN placeholder_count = 0;
END;
$$;

-- Fix 2: count_placeholder_lessons_in_published — ops monitoring
-- Replace ILIKE with JSON field check + exclude mini_check
CREATE OR REPLACE FUNCTION public.count_placeholder_lessons_in_published()
RETURNS TABLE(count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*) AS count
  FROM lessons l
  JOIN modules m ON m.id = l.module_id
  JOIN courses c ON c.id = m.course_id
  JOIN course_packages cp ON cp.course_id = c.id
  WHERE cp.status = 'published'
    AND l.step != 'mini_check'
    AND (l.content->>'_placeholder' = 'true' OR l.content IS NULL);
$$;

-- Fix 3: get_next_hollow_lessons — used by content scheduler
-- Replace ILIKE with JSON field check + exclude mini_check
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
    AND l.step != 'mini_check'
    AND (
      l.content->>'_placeholder' = 'true'
      OR l.content IS NULL
      OR length(COALESCE(l.content::text,'')) < 600
    )
  ORDER BY l.created_at ASC NULLS FIRST, l.id
  LIMIT GREATEST(1, LEAST(p_limit, 25));
$$;

REVOKE ALL ON FUNCTION public.get_next_hollow_lessons(uuid,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_hollow_lessons(uuid,int) TO service_role;
