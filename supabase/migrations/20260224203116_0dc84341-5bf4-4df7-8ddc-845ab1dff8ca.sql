
-- Drop dependent view first
DROP VIEW IF EXISTS public.elite_readiness_global;
DROP VIEW IF EXISTS public.elite_readiness_per_curriculum;

-- SSOT Columns
ALTER TABLE public.competencies ADD COLUMN IF NOT EXISTS bloom_source text DEFAULT 'unknown';
ALTER TABLE public.competencies ADD COLUMN IF NOT EXISTS enrichment_version int DEFAULT 0;
ALTER TABLE public.competencies ADD COLUMN IF NOT EXISTS enriched_at timestamptz;

-- Phase 1 RPC
CREATE OR REPLACE FUNCTION public.get_phase1_candidates(
  p_curriculum_id uuid DEFAULT NULL,
  p_field text DEFAULT 'bloom_level',
  p_limit int DEFAULT 150
)
RETURNS TABLE(
  id uuid, title text, description text, taxonomy_level text,
  bloom_level text, learning_field_id uuid, exam_part text, weight_percent numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT c.id, c.title, c.description, c.taxonomy_level, c.bloom_level,
         c.learning_field_id, lf.exam_part, lf.weight_percent
  FROM competencies c
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE (p_curriculum_id IS NULL OR lf.curriculum_id = p_curriculum_id)
    AND ((p_field = 'bloom_level' AND c.bloom_level IS NULL)
      OR (p_field = 'exam_relevance_tier' AND c.exam_relevance_tier IS NULL)
      OR (p_field = 'action_verb' AND c.action_verb IS NULL))
  ORDER BY c.created_at LIMIT p_limit;
$$;

-- Phase 2 RPC
CREATE OR REPLACE FUNCTION public.get_phase2_candidates(
  p_curriculum_id uuid DEFAULT NULL,
  p_limit int DEFAULT 30
)
RETURNS TABLE(
  id uuid, title text, description text, bloom_level text,
  action_verb text, exam_relevance_tier text, learning_field_id uuid,
  lf_title text, exam_part text, curriculum_title text,
  profession_name text, needs_misconceptions boolean, needs_transfer boolean
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT c.id, c.title, c.description, c.bloom_level, c.action_verb,
         c.exam_relevance_tier, c.learning_field_id,
         lf.title, lf.exam_part, cur.title, b.bezeichnung_kurz,
         (c.typical_misconceptions IS NULL OR jsonb_array_length(COALESCE(c.typical_misconceptions,'[]'::jsonb)) < 2),
         (c.transfer_markers IS NULL OR jsonb_array_length(COALESCE(c.transfer_markers,'[]'::jsonb)) < 1)
  FROM competencies c
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  JOIN curricula cur ON cur.id = lf.curriculum_id
  JOIN berufe b ON b.id = cur.beruf_id
  WHERE c.exam_relevance_tier IN ('core','important')
    AND (p_curriculum_id IS NULL OR lf.curriculum_id = p_curriculum_id)
    AND (c.typical_misconceptions IS NULL 
         OR jsonb_array_length(COALESCE(c.typical_misconceptions,'[]'::jsonb)) < 2
         OR c.transfer_markers IS NULL 
         OR jsonb_array_length(COALESCE(c.transfer_markers,'[]'::jsonb)) < 1)
  ORDER BY CASE c.exam_relevance_tier WHEN 'core' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, c.created_at
  LIMIT p_limit;
$$;

-- Recreate views with LATERAL joins + exam-relevant metrics
CREATE VIEW public.elite_readiness_per_curriculum
WITH (security_invoker = on) AS
SELECT 
  c.id AS curriculum_id, c.title AS curriculum_title,
  b.bezeichnung_kurz AS profession, b.id AS beruf_id,
  count(comp.id) AS total_competencies,
  count(comp.bloom_level) AS has_bloom,
  round(100.0 * count(comp.bloom_level)::numeric / NULLIF(count(comp.id),0)::numeric, 1) AS bloom_pct,
  count(comp.action_verb) AS has_action_verb,
  round(100.0 * count(comp.action_verb)::numeric / NULLIF(count(comp.id),0)::numeric, 1) AS action_verb_pct,
  count(comp.exam_relevance_tier) AS has_exam_tier,
  round(100.0 * count(comp.exam_relevance_tier)::numeric / NULLIF(count(comp.id),0)::numeric, 1) AS exam_tier_pct,
  count(CASE WHEN comp.typical_misconceptions IS NOT NULL AND jsonb_array_length(comp.typical_misconceptions) >= 2 THEN 1 END) AS has_misconceptions,
  count(CASE WHEN comp.transfer_markers IS NOT NULL AND jsonb_array_length(comp.transfer_markers) >= 1 THEN 1 END) AS has_transfer,
  count(CASE WHEN comp.bloom_level IS NOT NULL AND comp.action_verb IS NOT NULL AND comp.exam_relevance_tier IS NOT NULL THEN 1 END) AS elite_ready,
  round(100.0 * count(CASE WHEN comp.bloom_level IS NOT NULL AND comp.action_verb IS NOT NULL AND comp.exam_relevance_tier IS NOT NULL THEN 1 END)::numeric / NULLIF(count(comp.id),0)::numeric, 1) AS elite_ready_pct,
  count(CASE WHEN comp.exam_relevance_tier IN ('core','important') THEN 1 END) AS exam_relevant_count,
  count(CASE WHEN comp.exam_relevance_tier IN ('core','important') AND comp.typical_misconceptions IS NOT NULL AND jsonb_array_length(comp.typical_misconceptions) >= 2 THEN 1 END) AS exam_relevant_with_misconceptions,
  COALESCE(gl.has_glossary, false) AS has_glossary,
  COALESCE(pr.has_profile, false) AS has_profile
FROM curricula c
JOIN berufe b ON c.beruf_id = b.id
JOIN learning_fields lf ON lf.curriculum_id = c.id
JOIN competencies comp ON comp.learning_field_id = lf.id
LEFT JOIN LATERAL (SELECT true AS has_glossary FROM profession_glossaries pg WHERE pg.beruf_id = b.id AND pg.token_count > 0 LIMIT 1) gl ON true
LEFT JOIN LATERAL (SELECT true AS has_profile FROM profession_profiles pp WHERE pp.beruf_id = b.id LIMIT 1) pr ON true
GROUP BY c.id, c.title, b.id, b.bezeichnung_kurz, gl.has_glossary, pr.has_profile
ORDER BY elite_ready_pct;

CREATE VIEW public.elite_readiness_global
WITH (security_invoker = on) AS
SELECT 
  count(*) AS total_curricula,
  round(avg(bloom_pct),1) AS avg_bloom_pct,
  round(avg(action_verb_pct),1) AS avg_action_verb_pct,
  round(avg(exam_tier_pct),1) AS avg_exam_tier_pct,
  round(avg(elite_ready_pct),1) AS avg_elite_ready_pct,
  count(CASE WHEN has_glossary THEN 1 END) AS curricula_with_glossary,
  count(CASE WHEN has_profile THEN 1 END) AS curricula_with_profile,
  count(CASE WHEN bloom_pct >= 99 AND exam_tier_pct >= 99 AND action_verb_pct >= 80 THEN 1 END) AS phase1_complete,
  count(CASE WHEN elite_ready_pct >= 85 THEN 1 END) AS elite_ready_curricula,
  sum(exam_relevant_count) AS total_exam_relevant,
  sum(exam_relevant_with_misconceptions) AS total_with_misconceptions,
  round(100.0 * sum(exam_relevant_with_misconceptions)::numeric / NULLIF(sum(exam_relevant_count),0)::numeric, 1) AS misconception_coverage_pct
FROM elite_readiness_per_curriculum;
