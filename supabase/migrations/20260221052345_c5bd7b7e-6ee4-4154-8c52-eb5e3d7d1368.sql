
-- Fix v_course_content_integrity: MiniCheck lessons use 'questions' not 'html'
-- They were falsely counted as too_short, blocking pipeline progression
CREATE OR REPLACE VIEW public.v_course_content_integrity AS
SELECT 
  m.course_id,
  count(*) AS total_lessons,
  count(*) FILTER (WHERE ((l.content ->> '_placeholder'::text)::boolean) = true) AS placeholder_lessons,
  count(*) FILTER (WHERE 
    -- Exclude mini_check from too_short check (they have questions, not html)
    (l.content ->> 'type') IS DISTINCT FROM 'mini_check'
    AND (
      l.content IS NULL 
      OR (l.content ->> 'html'::text) IS NULL 
      OR length(COALESCE(l.content ->> 'html'::text, ''::text)) < 200
    )
  ) AS too_short_lessons
FROM lessons l
JOIN modules m ON l.module_id = m.id
GROUP BY m.course_id;
