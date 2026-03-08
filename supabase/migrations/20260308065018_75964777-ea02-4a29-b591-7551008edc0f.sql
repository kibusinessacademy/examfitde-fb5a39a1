
-- ============================================================
-- Qualification Catalog + Fortbildung Intake Extension
-- ============================================================

-- 1) qualification_catalog — SSOT for qualifications
CREATE TABLE IF NOT EXISTS public.qualification_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_title text NOT NULL,
  education_type text NOT NULL,
  award_type text NOT NULL,
  provider_family text,
  legal_basis text,
  source_authority text,
  qualification_level text,
  version_label text,
  version_date date,
  is_regulated boolean NOT NULL DEFAULT true,
  canonical_slug text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qualification_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_qualification_catalog" ON public.qualification_catalog FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2) Extend curriculum_intake_parsed with fortbildung fields
ALTER TABLE public.curriculum_intake_parsed
  ADD COLUMN IF NOT EXISTS qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exam_parts jsonb,
  ADD COLUMN IF NOT EXISTS handlungsbereiche jsonb,
  ADD COLUMN IF NOT EXISTS oral_components jsonb,
  ADD COLUMN IF NOT EXISTS project_components jsonb,
  ADD COLUMN IF NOT EXISTS pass_rules jsonb,
  ADD COLUMN IF NOT EXISTS title_aliases jsonb;

-- 3) qualification_curriculum_drafts — drafts built from catalog
CREATE TABLE IF NOT EXISTS public.qualification_curriculum_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_catalog_id uuid NOT NULL REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  draft_title text NOT NULL,
  education_type text NOT NULL,
  award_type text,
  structure_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness_score numeric(5,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  promoted_curriculum_id uuid REFERENCES public.curricula(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (qualification_catalog_id)
);

ALTER TABLE public.qualification_curriculum_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_qual_drafts" ON public.qualification_curriculum_drafts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4) qualification_wave_candidates
CREATE TABLE IF NOT EXISTS public.qualification_wave_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_catalog_id uuid NOT NULL REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  draft_id uuid REFERENCES public.qualification_curriculum_drafts(id) ON DELETE SET NULL,
  candidate_status text NOT NULL DEFAULT 'pending',
  readiness_score numeric(5,2) DEFAULT 0,
  market_score numeric(5,2) DEFAULT 0,
  promotion_priority numeric(10,2) DEFAULT 0,
  award_type text,
  provider_family text,
  wave_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (qualification_catalog_id)
);

ALTER TABLE public.qualification_wave_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_qual_wave" ON public.qualification_wave_candidates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5) Title normalization function
CREATE OR REPLACE FUNCTION public.normalize_qualification_title(p_title text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v text := lower(trim(p_title));
BEGIN
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := replace(v, 'ihk', '');
  v := replace(v, 'hwk', '');
  v := replace(v, 'master professional in business management', '');
  v := replace(v, 'bachelor professional', '');
  v := trim(v);

  IF v LIKE '%betriebswirt%' THEN RETURN 'gepruefter betriebswirt'; END IF;
  IF v LIKE '%wirtschaftsfachwirt%' THEN RETURN 'gepruefter wirtschaftsfachwirt'; END IF;
  IF v LIKE '%technischer fachwirt%' THEN RETURN 'gepruefter technischer fachwirt'; END IF;
  IF v LIKE '%bilanzbuchhalter%' THEN RETURN 'gepruefter bilanzbuchhalter'; END IF;
  IF v LIKE '%controller%' THEN RETURN 'gepruefter controller'; END IF;
  IF v LIKE '%fachmann%kaufm%betriebsf%' THEN RETURN 'gepruefter fachmann fuer kaufmaennische betriebsfuehrung'; END IF;
  IF v LIKE '%meister%' THEN RETURN 'meister'; END IF;
  IF v LIKE '%fachwirt%' THEN RETURN regexp_replace(v, '[^a-z0-9 ]', '', 'g'); END IF;
  IF v LIKE '%fachkaufmann%' OR v LIKE '%fachkauffrau%' THEN RETURN regexp_replace(v, '[^a-z0-9 ]', '', 'g'); END IF;

  RETURN regexp_replace(v, '[^a-z0-9 ]', '', 'g');
END;
$$;

-- 6) Catalog upsert from candidate
CREATE OR REPLACE FUNCTION public.upsert_qualification_catalog_from_candidate(
  p_candidate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c public.curriculum_intake_candidates%ROWTYPE;
  v_p public.curriculum_intake_parsed%ROWTYPE;
  v_norm text;
  v_slug text;
  v_id uuid;
BEGIN
  SELECT * INTO v_c FROM public.curriculum_intake_candidates WHERE id = p_candidate_id;
  SELECT * INTO v_p FROM public.curriculum_intake_parsed WHERE candidate_id = p_candidate_id;

  IF v_c IS NULL OR v_p IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_candidate_or_parsed');
  END IF;

  v_norm := public.normalize_qualification_title(
    COALESCE(v_p.title_normalized, v_c.canonical_title, v_c.title_raw)
  );
  v_slug := regexp_replace(v_norm, '[^a-z0-9]+', '-', 'g');

  INSERT INTO public.qualification_catalog (
    canonical_title, education_type, award_type, provider_family,
    legal_basis, source_authority, qualification_level,
    version_label, version_date, canonical_slug, metadata
  )
  VALUES (
    v_norm,
    COALESCE(v_p.education_type, 'certification'),
    COALESCE(v_p.award_type, 'sonstige'),
    CASE
      WHEN v_c.source_key = 'ihk' THEN 'IHK'
      WHEN v_c.source_key = 'hwk' THEN 'HWK'
      WHEN v_c.source_key = 'bibb' THEN 'BIBB'
      WHEN v_c.source_key = 'kmk' THEN 'KMK'
      ELSE 'Sonstige'
    END,
    NULL,
    v_p.source_authority,
    CASE
      WHEN COALESCE(v_p.award_type,'') = 'betriebswirt' THEN 'master_professional'
      WHEN COALESCE(v_p.award_type,'') IN ('fachwirt','fachkaufmann','meister','bilanzbuchhalter','controller') THEN 'bachelor_professional'
      ELSE NULL
    END,
    v_c.version_label,
    v_c.version_date,
    v_slug,
    jsonb_build_object('candidate_id', p_candidate_id, 'source_key', v_c.source_key)
  )
  ON CONFLICT (canonical_slug)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;

  UPDATE public.curriculum_intake_parsed
  SET qualification_catalog_id = v_id, updated_at = now()
  WHERE candidate_id = p_candidate_id;

  RETURN jsonb_build_object('ok', true, 'qualification_catalog_id', v_id, 'canonical_title', v_norm);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_qualification_catalog_from_candidate(uuid) TO service_role;

-- 7) Build curriculum draft from catalog entry
CREATE OR REPLACE FUNCTION public.build_qualification_curriculum_draft(
  p_catalog_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat public.qualification_catalog%ROWTYPE;
  v_parsed record;
  v_structure jsonb;
  v_readiness numeric := 0;
  v_draft_id uuid;
BEGIN
  SELECT * INTO v_cat FROM public.qualification_catalog WHERE id = p_catalog_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'catalog_not_found');
  END IF;

  SELECT * INTO v_parsed
  FROM public.curriculum_intake_parsed
  WHERE qualification_catalog_id = p_catalog_id
  ORDER BY source_confidence DESC NULLS LAST
  LIMIT 1;

  v_structure := jsonb_build_object(
    'education_type', v_cat.education_type,
    'award_type', v_cat.award_type,
    'provider_family', v_cat.provider_family,
    'qualification_level', v_cat.qualification_level,
    'learning_fields', COALESCE(v_parsed.learning_fields, '[]'::jsonb),
    'competency_areas', COALESCE(v_parsed.competency_areas, '[]'::jsonb),
    'exam_parts', COALESCE(v_parsed.exam_parts, '[]'::jsonb),
    'handlungsbereiche', COALESCE(v_parsed.handlungsbereiche, '[]'::jsonb),
    'oral_components', COALESCE(v_parsed.oral_components, '[]'::jsonb),
    'project_components', COALESCE(v_parsed.project_components, '[]'::jsonb),
    'pass_rules', COALESCE(v_parsed.pass_rules, '{}'::jsonb),
    'admission_rules', COALESCE(v_parsed.admission_rules, '{}'::jsonb),
    'exam_structure', COALESCE(v_parsed.exam_structure, '{}'::jsonb)
  );

  -- Calculate readiness
  v_readiness := LEAST(100,
    CASE WHEN v_cat.education_type = 'dual_ausbildung'
      THEN (jsonb_array_length(COALESCE(v_parsed.learning_fields, '[]'::jsonb)) * 8)
      ELSE (jsonb_array_length(COALESCE(v_parsed.competency_areas, '[]'::jsonb)) * 12
            + jsonb_array_length(COALESCE(v_parsed.exam_parts, '[]'::jsonb)) * 15
            + jsonb_array_length(COALESCE(v_parsed.handlungsbereiche, '[]'::jsonb)) * 10)
    END
    + COALESCE(v_parsed.source_confidence, 0) * 0.2
  );

  INSERT INTO public.qualification_curriculum_drafts (
    qualification_catalog_id, draft_title, education_type, award_type,
    structure_json, readiness_score, status
  )
  VALUES (
    p_catalog_id, v_cat.canonical_title, v_cat.education_type, v_cat.award_type,
    v_structure, v_readiness, CASE WHEN v_readiness >= 60 THEN 'ready' ELSE 'draft' END
  )
  ON CONFLICT (qualification_catalog_id)
  DO UPDATE SET
    structure_json = EXCLUDED.structure_json,
    readiness_score = EXCLUDED.readiness_score,
    status = CASE WHEN EXCLUDED.readiness_score >= 60 THEN 'ready' ELSE 'draft' END,
    updated_at = now()
  RETURNING id INTO v_draft_id;

  RETURN jsonb_build_object('ok', true, 'draft_id', v_draft_id, 'readiness', v_readiness);
END;
$$;

GRANT EXECUTE ON FUNCTION public.build_qualification_curriculum_draft(uuid) TO service_role;

-- 8) Sync wave candidates from ready drafts
CREATE OR REPLACE FUNCTION public.sync_qualification_wave_candidates(
  p_min_readiness numeric DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_synced int := 0;
BEGIN
  INSERT INTO public.qualification_wave_candidates (
    qualification_catalog_id, draft_id, candidate_status,
    readiness_score, award_type, provider_family, promotion_priority
  )
  SELECT
    d.qualification_catalog_id,
    d.id,
    'ready',
    d.readiness_score,
    d.award_type,
    qc.provider_family,
    d.readiness_score * 0.7 + COALESCE((qc.metadata->>'market_score')::numeric, 50) * 0.3
  FROM public.qualification_curriculum_drafts d
  JOIN public.qualification_catalog qc ON qc.id = d.qualification_catalog_id
  WHERE d.readiness_score >= p_min_readiness
    AND d.status IN ('ready', 'draft')
    AND NOT EXISTS (
      SELECT 1 FROM public.qualification_wave_candidates wc
      WHERE wc.qualification_catalog_id = d.qualification_catalog_id
    )
  ON CONFLICT (qualification_catalog_id) DO UPDATE SET
    readiness_score = EXCLUDED.readiness_score,
    promotion_priority = EXCLUDED.promotion_priority,
    updated_at = now();

  GET DIAGNOSTICS v_synced = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'synced', v_synced);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_qualification_wave_candidates(numeric) TO service_role;
