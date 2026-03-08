-- Fix get_ready_curricula: competencies join via learning_fields
DROP FUNCTION IF EXISTS public.get_ready_curricula(int);

CREATE FUNCTION public.get_ready_curricula(p_limit int DEFAULT 20)
RETURNS TABLE (
  curriculum_id uuid,
  title text,
  track text,
  enrichment_progress numeric,
  learning_fields bigint,
  competencies bigint,
  blueprints bigint
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS curriculum_id,
    c.title,
    c.track,
    c.enrichment_progress,
    count(DISTINCT lf.id) AS learning_fields,
    count(DISTINCT comp.id) AS competencies,
    count(DISTINCT qb.id) AS blueprints
  FROM public.curricula c
  LEFT JOIN public.learning_fields lf ON lf.curriculum_id = c.id
  LEFT JOIN public.competencies comp ON comp.learning_field_id = lf.id
  LEFT JOIN public.question_blueprints qb ON qb.curriculum_id = c.id
  WHERE c.enrichment_progress >= 100
    AND c.status NOT IN ('archived')
    AND NOT EXISTS (
      SELECT 1 FROM public.curricula c2
      JOIN public.courses co2 ON co2.curriculum_id = c2.id
      JOIN public.course_packages cp ON cp.course_id = co2.id
      WHERE c2.beruf_id = c.beruf_id
        AND c2.track = c.track
        AND c2.id != c.id
        AND c2.status NOT IN ('archived')
        AND cp.status IN ('planning','queued','building','failed','draft','published')
    )
  GROUP BY c.id
  HAVING
    count(DISTINCT lf.id) >= 8
    AND count(DISTINCT comp.id) >= 40
    AND count(DISTINCT qb.id) >= 50
  ORDER BY c.created_at
  LIMIT p_limit;
END;
$$;