
-- Fix: Prioritize curricula closest to 100% enrichment (ASC instead of DESC)
-- This unblocks the pipeline by finishing the 25 curricula with only 1 remaining competency
CREATE OR REPLACE FUNCTION public.get_unenriched_curricula_batch(p_limit integer DEFAULT 5)
RETURNS TABLE(
  curriculum_id uuid,
  curriculum_title text,
  beruf_kurz text,
  beruf_lang text,
  zustaendigkeit text,
  taetigkeitsprofil text,
  unenriched_count bigint
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
WITH cur AS (
  SELECT lf.curriculum_id, count(*) AS unenriched_count
  FROM public.competencies c
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  WHERE (c.enrichment_version IS NULL OR c.enrichment_version < 2)
  GROUP BY lf.curriculum_id
  ORDER BY count(*) ASC  -- CHANGED: prioritize almost-done curricula to unblock pipeline
  LIMIT p_limit
)
SELECT
  cu.id, cu.title,
  b.bezeichnung_kurz, b.bezeichnung_lang,
  b.zustaendigkeit, b.taetigkeitsprofil,
  cur.unenriched_count
FROM cur
JOIN public.curricula cu ON cu.id = cur.curriculum_id
JOIN public.berufe b ON b.id = cu.beruf_id;
$$;
