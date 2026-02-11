
CREATE OR REPLACE FUNCTION public.get_course_pipeline_stats(p_course_ids uuid[])
RETURNS TABLE(
  course_id uuid,
  lesson_count bigint,
  filled_count bigint,
  stub_count bigint,
  minicheck_count bigint,
  weight_tag_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    m.course_id,
    count(l.id) AS lesson_count,
    count(l.id) FILTER (WHERE length(l.content::text) > 200) AS filled_count,
    count(l.id) FILTER (WHERE l.content::text ILIKE '%wird generiert%') AS stub_count,
    (SELECT count(*) FROM minicheck_questions mq WHERE mq.lesson_id = ANY(array_agg(l.id))) AS minicheck_count,
    count(l.id) FILTER (WHERE l.weight_tag IS NOT NULL) AS weight_tag_count
  FROM modules m
  JOIN lessons l ON l.module_id = m.id
  WHERE m.course_id = ANY(p_course_ids)
  GROUP BY m.course_id;
$$;
