
-- =============================================
-- ELITE ENRICHMENT INFRASTRUCTURE
-- =============================================

-- 1) profession_profiles table (Phase 3)
CREATE TABLE IF NOT EXISTS public.profession_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  beruf_id UUID NOT NULL REFERENCES public.berufe(id),
  profession_name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  profile JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(beruf_id, version)
);

ALTER TABLE public.profession_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read for authenticated" ON public.profession_profiles FOR SELECT USING (true);
CREATE POLICY "Allow service role full access" ON public.profession_profiles FOR ALL USING (true);

-- 2) Add bloom_inferred flag to competencies for Phase 1 tracking
ALTER TABLE public.competencies ADD COLUMN IF NOT EXISTS bloom_inferred BOOLEAN DEFAULT false;

-- 3) Elite-Readiness materialized view for KPI Dashboard
CREATE OR REPLACE VIEW public.elite_readiness_per_curriculum AS
SELECT
  c.id AS curriculum_id,
  c.title AS curriculum_title,
  b.bezeichnung_kurz AS profession,
  COUNT(comp.id) AS total_competencies,
  
  -- Phase 1 metrics
  COUNT(comp.bloom_level) AS has_bloom,
  ROUND(100.0 * COUNT(comp.bloom_level) / NULLIF(COUNT(comp.id), 0), 1) AS bloom_pct,
  COUNT(comp.action_verb) AS has_action_verb,
  ROUND(100.0 * COUNT(comp.action_verb) / NULLIF(COUNT(comp.id), 0), 1) AS action_verb_pct,
  COUNT(comp.exam_relevance_tier) AS has_exam_tier,
  ROUND(100.0 * COUNT(comp.exam_relevance_tier) / NULLIF(COUNT(comp.id), 0), 1) AS exam_tier_pct,
  
  -- Phase 2 metrics
  COUNT(CASE WHEN comp.typical_misconceptions IS NOT NULL 
    AND jsonb_array_length(comp.typical_misconceptions) >= 2 THEN 1 END) AS has_misconceptions,
  COUNT(CASE WHEN comp.transfer_markers IS NOT NULL 
    AND jsonb_array_length(comp.transfer_markers) >= 1 THEN 1 END) AS has_transfer,
  
  -- Elite-ready count
  COUNT(CASE WHEN comp.bloom_level IS NOT NULL 
    AND comp.action_verb IS NOT NULL 
    AND comp.exam_relevance_tier IS NOT NULL THEN 1 END) AS elite_ready,
  ROUND(100.0 * COUNT(CASE WHEN comp.bloom_level IS NOT NULL 
    AND comp.action_verb IS NOT NULL 
    AND comp.exam_relevance_tier IS NOT NULL THEN 1 END) / NULLIF(COUNT(comp.id), 0), 1) AS elite_ready_pct,
  
  -- Phase 3 flags
  EXISTS(SELECT 1 FROM profession_glossaries pg WHERE pg.beruf_id = b.id AND pg.token_count > 0) AS has_glossary,
  EXISTS(SELECT 1 FROM profession_profiles pp WHERE pp.beruf_id = b.id) AS has_profile

FROM curricula c
JOIN berufe b ON c.beruf_id = b.id
JOIN learning_fields lf ON lf.curriculum_id = c.id
JOIN competencies comp ON comp.learning_field_id = lf.id
GROUP BY c.id, c.title, b.id, b.bezeichnung_kurz
ORDER BY elite_ready_pct ASC;

-- 4) Summary view for global KPI
CREATE OR REPLACE VIEW public.elite_readiness_global AS
SELECT
  COUNT(*) AS total_curricula,
  ROUND(AVG(bloom_pct), 1) AS avg_bloom_pct,
  ROUND(AVG(action_verb_pct), 1) AS avg_action_verb_pct,
  ROUND(AVG(exam_tier_pct), 1) AS avg_exam_tier_pct,
  ROUND(AVG(elite_ready_pct), 1) AS avg_elite_ready_pct,
  COUNT(CASE WHEN has_glossary THEN 1 END) AS curricula_with_glossary,
  COUNT(CASE WHEN has_profile THEN 1 END) AS curricula_with_profile,
  COUNT(CASE WHEN bloom_pct >= 99 AND exam_tier_pct >= 99 AND action_verb_pct >= 80 THEN 1 END) AS phase1_complete,
  COUNT(CASE WHEN elite_ready_pct >= 85 THEN 1 END) AS elite_ready_curricula
FROM elite_readiness_per_curriculum;
