
-- Step 1: Score Versioning + package_quality_scores

-- Versioned score formula
CREATE TABLE IF NOT EXISTS public.quality_score_versions (
  version int PRIMARY KEY,
  weights jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed V1 weights
INSERT INTO public.quality_score_versions (version, weights) VALUES (1, '{
  "blueprint_coverage": 0.35,
  "lf_coverage": 0.00,
  "duplicate_rate": 0.15,
  "difficulty_distribution": 0.10,
  "minicheck_presence": 0.15,
  "exam_relevance": 0.15,
  "tutor_purity": 0.10
}'::jsonb) ON CONFLICT (version) DO NOTHING;

-- Per-package quality score with badge
CREATE TABLE IF NOT EXISTS public.package_quality_scores (
  package_id uuid PRIMARY KEY,
  score_version int NOT NULL REFERENCES public.quality_score_versions(version),
  score numeric NOT NULL,
  badge text NOT NULL CHECK (badge IN ('bronze','silver','gold','platinum')),
  public_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add rules_passed / rules_failed / rules_warned columns to package_quality_reports if missing
ALTER TABLE public.package_quality_reports
  ADD COLUMN IF NOT EXISTS rules_passed int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rules_failed int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rules_warned int NOT NULL DEFAULT 0;

-- Product Factory Spec table
CREATE TABLE IF NOT EXISTS public.product_factory_specs (
  certification_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  spec jsonb NOT NULL DEFAULT '{
    "freeze": {"enabled": true},
    "learning_course": {"enabled": true},
    "exam_pool": {"enabled": true, "min_questions": 800},
    "minichecks": {"enabled": true, "per_lesson": 5},
    "tutor": {"enabled": true},
    "oral_exam": {"enabled": true, "min_questions": 80},
    "handbook": {"enabled": true},
    "quality": {"enabled": true, "block_on_fail": true},
    "seo_pages": {"enabled": true, "page_types": ["landing","faq","simulation","struktur","schwierigkeit","durchfallquote","qualitaet"]}
  }'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.quality_score_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_quality_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_factory_specs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quality_score_versions_read" ON public.quality_score_versions FOR SELECT USING (true);
CREATE POLICY "package_quality_scores_read" ON public.package_quality_scores FOR SELECT USING (true);
CREATE POLICY "product_factory_specs_service" ON public.product_factory_specs FOR ALL USING (true) WITH CHECK (true);

-- RPC: get_quality_public_summary (for SEO pages)
CREATE OR REPLACE FUNCTION public.get_quality_public_summary(p_certification_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'score', pqs.score,
    'badge', pqs.badge,
    'score_version', pqs.score_version,
    'updated_at', pqs.updated_at,
    'summary', pqs.public_summary
  )
  FROM public.package_quality_scores pqs
  JOIN public.course_packages cp ON cp.id = pqs.package_id
  WHERE cp.certification_id = p_certification_id
    AND cp.status = 'published'
  ORDER BY pqs.updated_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_quality_public_summary(uuid) TO anon, authenticated, service_role;

-- Seed factory specs for all existing certifications
INSERT INTO public.product_factory_specs (certification_id)
SELECT id FROM public.certification_catalog
ON CONFLICT (certification_id) DO NOTHING;
