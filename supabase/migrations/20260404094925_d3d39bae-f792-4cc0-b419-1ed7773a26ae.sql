
DROP FUNCTION IF EXISTS public.get_unenriched_curricula_batch(integer);

CREATE FUNCTION public.get_unenriched_curricula_batch(p_limit integer DEFAULT 5)
RETURNS TABLE(
  id uuid,
  title text,
  bezeichnung_kurz text,
  bezeichnung_lang text,
  zustaendigkeit text,
  taetigkeitsprofil text,
  unenriched_count bigint
)
LANGUAGE sql STABLE
AS $$
WITH cur AS (
  SELECT lf.curriculum_id, count(*) AS unenriched_count
  FROM public.competencies c
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  WHERE (c.enrichment_version IS NULL OR c.enrichment_version < 2)
  GROUP BY lf.curriculum_id
  ORDER BY count(*) ASC
  LIMIT p_limit
)
SELECT
  cu.id,
  cu.title,
  COALESCE(b.bezeichnung_kurz, cu.title)    AS bezeichnung_kurz,
  COALESCE(b.bezeichnung_lang, cu.title)     AS bezeichnung_lang,
  COALESCE(b.zustaendigkeit, 'Hochschule')   AS zustaendigkeit,
  b.taetigkeitsprofil,
  cur.unenriched_count
FROM cur
JOIN public.curricula cu ON cu.id = cur.curriculum_id
LEFT JOIN public.berufe b ON b.id = cu.beruf_id;
$$;
