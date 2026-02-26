-- 1) Partial index: fast filter on unenriched competencies
CREATE INDEX IF NOT EXISTS idx_competencies_unenriched_lf
ON public.competencies (learning_field_id)
WHERE (enrichment_version IS NULL OR enrichment_version < 2);

-- 2) Lookup learning_fields → curriculum
CREATE INDEX IF NOT EXISTS idx_learning_fields_curriculum_id
ON public.learning_fields (curriculum_id);

-- 3) Composite for remaining counts
CREATE INDEX IF NOT EXISTS idx_competencies_lf_enrichment_version
ON public.competencies (learning_field_id, enrichment_version);

-- ════════════════════════════════════════════
-- RPC: Next unenriched curricula batch
-- ════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_unenriched_curricula_batch(p_limit int DEFAULT 3)
RETURNS TABLE (
  curriculum_id uuid,
  curriculum_title text,
  beruf_kurz text,
  beruf_lang text,
  zustaendigkeit text,
  taetigkeitsprofil text,
  unenriched_count bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
WITH cur AS (
  SELECT lf.curriculum_id, count(*) AS unenriched_count
  FROM public.competencies c
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  WHERE (c.enrichment_version IS NULL OR c.enrichment_version < 2)
  GROUP BY lf.curriculum_id
  ORDER BY count(*) DESC
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

-- ════════════════════════════════════════════
-- RPC: Next unenriched competencies for a curriculum
-- ════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_unenriched_competencies_for_curriculum(
  p_curriculum_id uuid,
  p_limit int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  title text,
  bloom_level text,
  action_verb text,
  exam_relevance_tier text,
  learning_field_title text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
SELECT c.id, c.title, c.bloom_level, c.action_verb, c.exam_relevance_tier, lf.title
FROM public.competencies c
JOIN public.learning_fields lf ON lf.id = c.learning_field_id
WHERE lf.curriculum_id = p_curriculum_id
  AND (c.enrichment_version IS NULL OR c.enrichment_version < 2)
ORDER BY c.created_at ASC
LIMIT p_limit;
$$;

-- ════════════════════════════════════════════
-- RPC: Fast remaining count
-- ════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.count_unenriched_competencies_for_curriculum(p_curriculum_id uuid)
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
SELECT count(*)
FROM public.competencies c
JOIN public.learning_fields lf ON lf.id = c.learning_field_id
WHERE lf.curriculum_id = p_curriculum_id
  AND (c.enrichment_version IS NULL OR c.enrichment_version < 2);
$$;

-- Lock down RPCs to service_role only
REVOKE EXECUTE ON FUNCTION public.get_unenriched_curricula_batch(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unenriched_curricula_batch(int) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_unenriched_competencies_for_curriculum(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unenriched_competencies_for_curriculum(uuid, int) TO service_role;

REVOKE EXECUTE ON FUNCTION public.count_unenriched_competencies_for_curriculum(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_unenriched_competencies_for_curriculum(uuid) TO service_role;