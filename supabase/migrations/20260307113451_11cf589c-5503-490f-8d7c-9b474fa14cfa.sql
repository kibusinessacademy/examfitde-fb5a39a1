
-- ══════════════════════════════════════════════════════════════
-- SSOT UTILITY: is_hollow_lesson(content jsonb, step text)
-- Single source of truth for "is this lesson hollow/placeholder?"
-- ══════════════════════════════════════════════════════════════

-- Drop if exists to avoid signature conflicts
DROP FUNCTION IF EXISTS public.is_hollow_lesson(jsonb, text);

CREATE OR REPLACE FUNCTION public.is_hollow_lesson(p_content jsonb, p_step text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    CASE WHEN p_step = 'mini_check' THEN false
    ELSE (
      p_content IS NULL
      OR p_content->>'_placeholder' = 'true'
      OR length(COALESCE(p_content::text, '')) < 600
    )
    END;
$$;

COMMENT ON FUNCTION public.is_hollow_lesson(jsonb, text) IS
  'SSOT: Single check for hollow/placeholder lessons. Excludes mini_check. '
  'Use this everywhere instead of inline checks to prevent SSOT drift.';

-- 1. check_no_placeholder_lessons — cast step to text
CREATE OR REPLACE FUNCTION public.check_no_placeholder_lessons(p_course_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hollow_count integer;
BEGIN
  SELECT count(*) INTO hollow_count
  FROM lessons l
  JOIN modules m ON l.module_id = m.id
  WHERE m.course_id = p_course_id
    AND is_hollow_lesson(l.content, l.step::text);

  RETURN hollow_count = 0;
END;
$$;

-- 2. count_placeholder_lessons_in_published — cast step to text
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
    AND is_hollow_lesson(l.content, l.step::text);
$$;

-- 3. get_next_hollow_lessons — cast step to text
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
    AND is_hollow_lesson(l.content, l.step::text)
  ORDER BY l.created_at ASC NULLS FIRST, l.id
  LIMIT GREATEST(1, LEAST(p_limit, 25));
$$;

REVOKE ALL ON FUNCTION public.get_next_hollow_lessons(uuid,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_hollow_lessons(uuid,int) TO service_role;
