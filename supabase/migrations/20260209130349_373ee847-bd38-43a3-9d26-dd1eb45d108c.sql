
CREATE OR REPLACE FUNCTION public.get_placeholder_lessons(p_course_id uuid DEFAULT NULL, p_limit int DEFAULT 20)
RETURNS TABLE(
  id uuid,
  title text,
  step text,
  content jsonb,
  competency_code text,
  competency_title text,
  competency_description text,
  competency_taxonomy_level text,
  course_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    l.id, l.title, l.step, l.content,
    c.code, c.title, c.description, c.taxonomy_level,
    m.course_id
  FROM lessons l
  JOIN modules m ON l.module_id = m.id
  JOIN competencies c ON l.competency_id = c.id
  WHERE (
    l.content::text ILIKE '%wird generiert%'
    OR l.content::text ILIKE '%Inhalt wird%'
    OR (l.step != 'mini_check' AND length(l.content::text) < 300)
    OR (l.step = 'mini_check' AND (
      l.content->'questions' IS NULL
      OR jsonb_array_length(COALESCE(l.content->'questions', '[]'::jsonb)) < 4
    ))
  )
  AND (p_course_id IS NULL OR m.course_id = p_course_id)
  ORDER BY l.sort_order
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.get_content_quality_stats()
RETURNS TABLE(
  total_lessons bigint,
  valid_lessons bigint,
  placeholder_count bigint,
  quality_percent numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH stats AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE NOT (
        l.content::text ILIKE '%wird generiert%'
        OR l.content::text ILIKE '%Inhalt wird%'
        OR (l.step != 'mini_check' AND length(l.content::text) < 300)
        OR (l.step = 'mini_check' AND (
          l.content->'questions' IS NULL
          OR jsonb_array_length(COALESCE(l.content->'questions', '[]'::jsonb)) < 4
        ))
      )) as valid
    FROM lessons l
  )
  SELECT 
    total,
    valid,
    total - valid,
    CASE WHEN total > 0 THEN ROUND((valid::numeric / total::numeric) * 100, 1) ELSE 100 END
  FROM stats;
$$;
