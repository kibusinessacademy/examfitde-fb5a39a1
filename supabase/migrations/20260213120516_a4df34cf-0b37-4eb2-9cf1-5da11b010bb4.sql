
-- =========================
-- 1) Coverage Quality Tier Enum
-- =========================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coverage_tier') THEN
    CREATE TYPE public.coverage_tier AS ENUM ('BLOCK', 'PASS', 'STRONG', 'DOMINANT');
  END IF;
END$$;

-- =========================
-- 2) Add tier columns to coverage_snapshots
-- =========================
ALTER TABLE public.coverage_snapshots
  ADD COLUMN IF NOT EXISTS tier public.coverage_tier,
  ADD COLUMN IF NOT EXISTS authority_eligible boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS seo_rollout_eligible boolean DEFAULT false;

-- =========================
-- 3) Add legal_priority weighting to curriculum_topic_coverage
-- =========================
ALTER TABLE public.curriculum_topic_coverage
  ADD COLUMN IF NOT EXISTS source_legal_priority int DEFAULT 50,
  ADD COLUMN IF NOT EXISTS blueprint_domain_id uuid REFERENCES public.dom_blueprint_domains(id) ON DELETE SET NULL;

-- =========================
-- 4) Enhanced compute_curriculum_coverage with tiers + legal priority
-- =========================
CREATE OR REPLACE FUNCTION public.compute_curriculum_coverage(p_certification_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_topics int;
  v_mapped_topics int;
  v_weighted_total numeric := 0;
  v_weighted_mapped numeric := 0;
  v_overall numeric;
  v_tier public.coverage_tier;
  v_authority_eligible boolean;
  v_seo_eligible boolean;
  v_by_domain jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_snapshot_id uuid;
  r record;
BEGIN
  -- Count all topics with legal-priority weighting
  -- Higher legal_priority sources contribute more to coverage score
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE mapped = true),
    COALESCE(SUM(
      CASE WHEN coverage_weight IS NOT NULL THEN coverage_weight
      ELSE (source_legal_priority::numeric / 100.0)  -- legal priority as weight fallback
      END
    ), 0),
    COALESCE(SUM(
      CASE WHEN mapped = true THEN
        CASE WHEN coverage_weight IS NOT NULL THEN coverage_weight
        ELSE (source_legal_priority::numeric / 100.0)
        END
      ELSE 0 END
    ), 0)
  INTO v_total_topics, v_mapped_topics, v_weighted_total, v_weighted_mapped
  FROM public.curriculum_topic_coverage
  WHERE certification_id = p_certification_id;

  -- Calculate overall coverage (weighted)
  IF v_weighted_total > 0 THEN
    v_overall := v_weighted_mapped / v_weighted_total;
  ELSE
    v_overall := 0;
  END IF;

  -- Determine tier
  v_tier := CASE
    WHEN v_overall >= 0.98 THEN 'DOMINANT'::public.coverage_tier
    WHEN v_overall >= 0.95 THEN 'STRONG'::public.coverage_tier
    WHEN v_overall >= 0.90 THEN 'PASS'::public.coverage_tier
    ELSE 'BLOCK'::public.coverage_tier
  END;

  -- Authority requires STRONG or DOMINANT (>=95%)
  v_authority_eligible := v_overall >= 0.95;
  -- SEO rollout requires at least STRONG (>=95%)
  v_seo_eligible := v_overall >= 0.95;

  -- Per-domain breakdown
  SELECT jsonb_agg(domain_row) INTO v_by_domain
  FROM (
    SELECT jsonb_build_object(
      'domain_key', ctc.blueprint_domain_key,
      'domain_id', ctc.blueprint_domain_id,
      'total', COUNT(*),
      'mapped', COUNT(*) FILTER (WHERE ctc.mapped = true),
      'coverage', CASE WHEN COUNT(*) > 0
        THEN ROUND((COUNT(*) FILTER (WHERE ctc.mapped = true))::numeric / COUNT(*)::numeric, 4)
        ELSE 0 END,
      'tier', CASE
        WHEN COUNT(*) = 0 THEN 'BLOCK'
        WHEN (COUNT(*) FILTER (WHERE ctc.mapped = true))::numeric / COUNT(*)::numeric >= 0.98 THEN 'DOMINANT'
        WHEN (COUNT(*) FILTER (WHERE ctc.mapped = true))::numeric / COUNT(*)::numeric >= 0.95 THEN 'STRONG'
        WHEN (COUNT(*) FILTER (WHERE ctc.mapped = true))::numeric / COUNT(*)::numeric >= 0.90 THEN 'PASS'
        ELSE 'BLOCK'
      END
    ) AS domain_row
    FROM public.curriculum_topic_coverage ctc
    WHERE ctc.certification_id = p_certification_id
      AND ctc.blueprint_domain_key IS NOT NULL
    GROUP BY ctc.blueprint_domain_key, ctc.blueprint_domain_id
  ) sub;

  -- Missing topics
  SELECT jsonb_agg(jsonb_build_object(
    'topic_id', ctc.topic_id,
    'domain_key', ctc.blueprint_domain_key,
    'legal_priority', ctc.source_legal_priority
  )) INTO v_missing
  FROM public.curriculum_topic_coverage ctc
  WHERE ctc.certification_id = p_certification_id
    AND ctc.mapped = false;

  -- Write snapshot
  INSERT INTO public.coverage_snapshots (
    certification_id, snapshot_type, overall_coverage, by_domain, missing_topics,
    tier, authority_eligible, seo_rollout_eligible
  ) VALUES (
    p_certification_id, 'computed', v_overall, COALESCE(v_by_domain, '[]'::jsonb),
    COALESCE(v_missing, '[]'::jsonb), v_tier, v_authority_eligible, v_seo_eligible
  ) RETURNING id INTO v_snapshot_id;

  RETURN jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'overall_coverage', ROUND(v_overall, 4),
    'tier', v_tier::text,
    'authority_eligible', v_authority_eligible,
    'seo_rollout_eligible', v_seo_eligible,
    'total_topics', v_total_topics,
    'mapped_topics', v_mapped_topics,
    'by_domain', COALESCE(v_by_domain, '[]'::jsonb),
    'missing_count', COALESCE(jsonb_array_length(v_missing), 0)
  );
END;
$$;

-- =========================
-- 5) Enhanced set_curriculum_hold with tier enforcement
-- =========================
CREATE OR REPLACE FUNCTION public.set_curriculum_hold_if_needed(p_certification_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest record;
  v_action text := 'none';
BEGIN
  -- Get latest snapshot
  SELECT * INTO v_latest
  FROM public.coverage_snapshots
  WHERE certification_id = p_certification_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_latest IS NULL THEN
    RETURN jsonb_build_object('action', 'no_snapshot', 'hold', true);
  END IF;

  -- BLOCK tier: prevent all content generation
  IF v_latest.tier = 'BLOCK' THEN
    -- Block blueprint from advancing
    UPDATE public.dom_blueprints
    SET status = 'draft'
    WHERE certification_id = p_certification_id
      AND status NOT IN ('locked', 'deprecated');
    v_action := 'blocked_content_generation';

  -- PASS tier: allow basic content, block authority features
  ELSIF v_latest.tier = 'PASS' THEN
    v_action := 'pass_basic_only';

  -- STRONG/DOMINANT: full access
  ELSE
    v_action := 'full_access';
  END IF;

  RETURN jsonb_build_object(
    'action', v_action,
    'tier', v_latest.tier::text,
    'overall_coverage', v_latest.overall_coverage,
    'authority_eligible', v_latest.authority_eligible,
    'seo_rollout_eligible', v_latest.seo_rollout_eligible,
    'hold', v_latest.tier = 'BLOCK'
  );
END;
$$;

-- =========================
-- 6) Add confidence column to coverage tracking
-- =========================
ALTER TABLE public.curriculum_topic_coverage
  ADD COLUMN IF NOT EXISTS confidence numeric DEFAULT NULL;
