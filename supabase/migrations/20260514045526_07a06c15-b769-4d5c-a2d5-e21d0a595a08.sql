-- Slice 1 / Migration 1: Foundation Schema for Programmatic SEO Intent-Pages
ALTER TABLE public.seo_content_pages
  ADD COLUMN IF NOT EXISTS competency_id uuid REFERENCES public.competencies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS intent_template text,
  ADD COLUMN IF NOT EXISTS sections_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS quality_score numeric,
  ADD COLUMN IF NOT EXISTS last_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS generation_source text NOT NULL DEFAULT 'hybrid_ssot_ai',
  ADD COLUMN IF NOT EXISTS generation_model text,
  ADD COLUMN IF NOT EXISTS generation_cost_eur numeric(8,4) DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS seo_content_pages_intent_uq
  ON public.seo_content_pages (curriculum_id, competency_id, intent_template, persona_type)
  WHERE competency_id IS NOT NULL AND intent_template IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_seo_content_pages_slug_status
  ON public.seo_content_pages (slug, status)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_seo_content_pages_intent_template
  ON public.seo_content_pages (intent_template)
  WHERE intent_template IS NOT NULL;

ALTER TABLE public.seo_templates
  DROP CONSTRAINT IF EXISTS seo_templates_doc_type_check;

ALTER TABLE public.seo_templates
  ADD CONSTRAINT seo_templates_doc_type_check
  CHECK (doc_type = ANY (ARRAY['landing','product','blog','faq','glossary','cluster','intent_page']));

ALTER TABLE public.seo_templates
  ADD COLUMN IF NOT EXISTS intent_key text;

CREATE INDEX IF NOT EXISTS idx_seo_templates_intent_key
  ON public.seo_templates (intent_key)
  WHERE intent_key IS NOT NULL;

INSERT INTO public.ops_job_type_registry (job_type, pool, lane, requires_package_id, is_governance, description)
VALUES (
  'seo_intent_page_generate',
  'core',
  'control',
  false,
  false,
  'Generiert eine SEO-Intent-Page (Curriculum x Kompetenz x Intent) via Hybrid-SSOT+AI'
)
ON CONFLICT (job_type) DO NOTHING;

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'migration_seo_intent_pages_schema',
  'system',
  'success',
  jsonb_build_object(
    'slice', 'slice_1',
    'changes', jsonb_build_array(
      'seo_content_pages: +competency_id,+intent_template,+sections_json,+quality_score,+last_generated_at,+generation_source,+generation_model,+generation_cost_eur',
      'seo_content_pages: unique partial index seo_content_pages_intent_uq',
      'seo_templates: doc_type CHECK +intent_page, +intent_key',
      'ops_job_type_registry: +seo_intent_page_generate'
    )
  )
);

DO $$
DECLARE v_cols int; v_idx int;
BEGIN
  SELECT COUNT(*) INTO v_cols FROM information_schema.columns
  WHERE table_schema='public' AND table_name='seo_content_pages'
    AND column_name IN ('competency_id','intent_template','sections_json','quality_score','last_generated_at','generation_source');
  SELECT COUNT(*) INTO v_idx FROM pg_indexes
  WHERE schemaname='public' AND tablename='seo_content_pages'
    AND indexname IN ('seo_content_pages_intent_uq','idx_seo_content_pages_slug_status','idx_seo_content_pages_intent_template');
  IF v_cols < 6 THEN RAISE EXCEPTION 'Smoke FAIL cols=%', v_cols; END IF;
  IF v_idx < 3 THEN RAISE EXCEPTION 'Smoke FAIL idx=%', v_idx; END IF;
  RAISE NOTICE 'Smoke OK cols=% idx=%', v_cols, v_idx;
END $$;