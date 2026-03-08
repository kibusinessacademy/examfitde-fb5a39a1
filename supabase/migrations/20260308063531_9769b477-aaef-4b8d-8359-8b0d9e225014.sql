
-- ============================================
-- Qualification Intake Pipeline Schema
-- ============================================

-- 1. Search Runs
CREATE TABLE IF NOT EXISTS public.qualification_search_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'pending',
  search_pattern_count int DEFAULT 0,
  result_count int DEFAULT 0,
  deduped_count int DEFAULT 0,
  error_count int DEFAULT 0,
  meta jsonb DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Discovery Patterns
CREATE TABLE IF NOT EXISTS public.qualification_discovery_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_phrase text NOT NULL,
  provider_family text,
  award_type text,
  priority int NOT NULL DEFAULT 5,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Source Registry (dedup)
CREATE TABLE IF NOT EXISTS public.qualification_source_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_url text NOT NULL UNIQUE,
  provider_family text,
  content_type text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  intake_candidate_id uuid,
  meta jsonb DEFAULT '{}'::jsonb
);

-- 4. Search Results
CREATE TABLE IF NOT EXISTS public.qualification_search_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.qualification_search_runs(id),
  pattern_id uuid REFERENCES public.qualification_discovery_patterns(id),
  provider_family text,
  search_phrase text,
  result_rank int,
  source_url text NOT NULL,
  title_raw text,
  snippet text,
  content_type_hint text,
  source_score numeric DEFAULT 0,
  source_registry_id uuid REFERENCES public.qualification_source_registry(id),
  is_deduped boolean DEFAULT false,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Fetch Queue
CREATE TABLE IF NOT EXISTS public.qualification_fetch_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_registry_id uuid NOT NULL REFERENCES public.qualification_source_registry(id),
  candidate_id uuid,
  status text NOT NULL DEFAULT 'pending',
  priority int NOT NULL DEFAULT 5,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  worker_id text,
  lease_until timestamptz,
  last_error text,
  last_http_status int,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- 6. Qualification Candidates
CREATE TABLE IF NOT EXISTS public.qualification_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_raw text NOT NULL,
  source_url text,
  provider_family text,
  source_type text DEFAULT 'html',
  award_type_hint text,
  status text NOT NULL DEFAULT 'new',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 7. Raw Documents
CREATE TABLE IF NOT EXISTS public.intake_raw_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.qualification_candidates(id),
  source_url text,
  content_type text,
  extracted_title text,
  content_text text,
  source_hash text,
  metadata jsonb DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- 8. Qualification Catalog
CREATE TABLE IF NOT EXISTS public.qualification_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES public.qualification_candidates(id),
  canonical_title text NOT NULL,
  education_type text,
  award_type text,
  provider_family text,
  qualification_level text,
  source_authority text,
  legal_basis text,
  regulation_reference text,
  exam_parts jsonb DEFAULT '[]'::jsonb,
  handlungsbereiche jsonb DEFAULT '[]'::jsonb,
  competency_areas jsonb DEFAULT '[]'::jsonb,
  oral_components jsonb DEFAULT '[]'::jsonb,
  project_components jsonb DEFAULT '[]'::jsonb,
  admission_rules jsonb DEFAULT '{}'::jsonb,
  pass_rules jsonb DEFAULT '{}'::jsonb,
  title_aliases text[] DEFAULT '{}',
  evidence jsonb DEFAULT '{}'::jsonb,
  quality_score numeric DEFAULT 0,
  warnings text[] DEFAULT '{}',
  parser_version text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 9. Curriculum Drafts
CREATE TABLE IF NOT EXISTS public.qualification_curriculum_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_catalog_id uuid NOT NULL REFERENCES public.qualification_catalog(id),
  draft_title text NOT NULL,
  structure_json jsonb DEFAULT '{}'::jsonb,
  readiness_score numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  promoted_curriculum_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 10. Wave Candidates
CREATE TABLE IF NOT EXISTS public.qualification_wave_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_catalog_id uuid NOT NULL REFERENCES public.qualification_catalog(id),
  draft_id uuid REFERENCES public.qualification_curriculum_drafts(id),
  candidate_status text NOT NULL DEFAULT 'pending',
  readiness_score numeric DEFAULT 0,
  market_score numeric DEFAULT 0,
  award_type text,
  provider_family text,
  promotion_priority numeric DEFAULT 0,
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- RPCs
-- ============================================

-- Register search result with dedup
CREATE OR REPLACE FUNCTION public.register_qualification_search_result(
  p_run_id uuid,
  p_pattern_id uuid,
  p_provider_family text,
  p_search_phrase text,
  p_result_rank int,
  p_source_url text,
  p_title_raw text,
  p_snippet text,
  p_content_type_hint text,
  p_source_score numeric,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registry_id uuid;
  v_deduped boolean := false;
  v_result_id uuid;
BEGIN
  -- Upsert into source registry
  INSERT INTO public.qualification_source_registry (canonical_url, provider_family, meta)
  VALUES (p_source_url, p_provider_family, jsonb_build_object('title_raw', p_title_raw))
  ON CONFLICT (canonical_url) DO UPDATE SET last_seen_at = now()
  RETURNING id INTO v_registry_id;

  -- Check if already seen in this run
  SELECT EXISTS(
    SELECT 1 FROM public.qualification_search_results
    WHERE run_id = p_run_id AND source_registry_id = v_registry_id
  ) INTO v_deduped;

  INSERT INTO public.qualification_search_results (
    run_id, pattern_id, provider_family, search_phrase,
    result_rank, source_url, title_raw, snippet,
    content_type_hint, source_score, source_registry_id, is_deduped, meta
  ) VALUES (
    p_run_id, p_pattern_id, p_provider_family, p_search_phrase,
    p_result_rank, p_source_url, p_title_raw, p_snippet,
    p_content_type_hint, p_source_score, v_registry_id, v_deduped, p_meta
  ) RETURNING id INTO v_result_id;

  RETURN jsonb_build_object(
    'result_id', v_result_id,
    'source_registry_id', v_registry_id,
    'deduped', v_deduped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_qualification_search_result(uuid,uuid,text,text,int,text,text,text,text,numeric,jsonb) TO service_role;

-- Enqueue fetch job
CREATE OR REPLACE FUNCTION public.enqueue_qualification_fetch(
  p_source_registry_id uuid,
  p_candidate_id uuid DEFAULT NULL,
  p_priority int DEFAULT 5,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.qualification_fetch_queue (source_registry_id, candidate_id, priority, payload)
  VALUES (p_source_registry_id, p_candidate_id, p_priority, p_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_qualification_fetch(uuid,uuid,int,jsonb) TO service_role;

-- Claim fetch jobs
CREATE OR REPLACE FUNCTION public.claim_qualification_fetch_jobs(
  p_limit int DEFAULT 10,
  p_worker_id text DEFAULT 'default',
  p_lease_minutes int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  source_registry_id uuid,
  candidate_id uuid,
  priority int,
  attempts int,
  max_attempts int,
  payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE public.qualification_fetch_queue q
    SET status = 'processing',
        worker_id = p_worker_id,
        lease_until = now() + (p_lease_minutes || ' minutes')::interval,
        attempts = q.attempts + 1,
        updated_at = now()
    WHERE q.id IN (
      SELECT q2.id FROM public.qualification_fetch_queue q2
      WHERE q2.status IN ('pending', 'failed')
        AND (q2.lease_until IS NULL OR q2.lease_until < now())
        AND q2.attempts < q2.max_attempts
      ORDER BY q2.priority DESC, q2.created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING q.id, q.source_registry_id, q.candidate_id, q.priority, q.attempts, q.max_attempts, q.payload
  )
  SELECT * FROM claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_qualification_fetch_jobs(int,text,int) TO service_role;

-- Upsert qualification candidate
CREATE OR REPLACE FUNCTION public.upsert_qualification_candidate(
  p_title_raw text,
  p_source_url text,
  p_provider_family text DEFAULT NULL,
  p_source_type text DEFAULT 'html',
  p_award_type_hint text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.qualification_candidates
  WHERE source_url = p_source_url LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.qualification_candidates
    SET updated_at = now(), metadata = p_metadata
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.qualification_candidates (title_raw, source_url, provider_family, source_type, award_type_hint, metadata)
  VALUES (p_title_raw, p_source_url, p_provider_family, p_source_type, p_award_type_hint, p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_qualification_candidate(text,text,text,text,text,jsonb) TO service_role;

-- Upsert parsed qualification model
CREATE OR REPLACE FUNCTION public.upsert_parsed_qualification_model(
  p_candidate_id uuid,
  p_parser_version text,
  p_canonical_title text,
  p_education_type text DEFAULT NULL,
  p_award_type text DEFAULT NULL,
  p_provider_family text DEFAULT NULL,
  p_source_authority text DEFAULT NULL,
  p_legal_basis text DEFAULT NULL,
  p_regulation_reference text DEFAULT NULL,
  p_exam_parts jsonb DEFAULT '[]'::jsonb,
  p_handlungsbereiche jsonb DEFAULT '[]'::jsonb,
  p_competency_areas jsonb DEFAULT '[]'::jsonb,
  p_oral_components jsonb DEFAULT '[]'::jsonb,
  p_project_components jsonb DEFAULT '[]'::jsonb,
  p_admission_rules jsonb DEFAULT '{}'::jsonb,
  p_pass_rules jsonb DEFAULT '{}'::jsonb,
  p_title_aliases text[] DEFAULT '{}',
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_quality_score numeric DEFAULT 0,
  p_warnings text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.qualification_catalog WHERE candidate_id = p_candidate_id LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.qualification_catalog SET
      canonical_title = p_canonical_title,
      education_type = p_education_type,
      award_type = p_award_type,
      provider_family = p_provider_family,
      source_authority = p_source_authority,
      legal_basis = p_legal_basis,
      regulation_reference = p_regulation_reference,
      exam_parts = p_exam_parts,
      handlungsbereiche = p_handlungsbereiche,
      competency_areas = p_competency_areas,
      oral_components = p_oral_components,
      project_components = p_project_components,
      admission_rules = p_admission_rules,
      pass_rules = p_pass_rules,
      title_aliases = p_title_aliases,
      evidence = p_evidence,
      quality_score = p_quality_score,
      warnings = p_warnings,
      parser_version = p_parser_version,
      updated_at = now()
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.qualification_catalog (
    candidate_id, canonical_title, education_type, award_type,
    provider_family, source_authority, legal_basis, regulation_reference,
    exam_parts, handlungsbereiche, competency_areas, oral_components,
    project_components, admission_rules, pass_rules, title_aliases,
    evidence, quality_score, warnings, parser_version
  ) VALUES (
    p_candidate_id, p_canonical_title, p_education_type, p_award_type,
    p_provider_family, p_source_authority, p_legal_basis, p_regulation_reference,
    p_exam_parts, p_handlungsbereiche, p_competency_areas, p_oral_components,
    p_project_components, p_admission_rules, p_pass_rules, p_title_aliases,
    p_evidence, p_quality_score, p_warnings, p_parser_version
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_parsed_qualification_model(uuid,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text[],jsonb,numeric,text[]) TO service_role;

-- Sync wave candidates
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
    readiness_score, market_score, award_type, provider_family, promotion_priority
  )
  SELECT
    d.qualification_catalog_id,
    d.id,
    'ready',
    d.readiness_score,
    COALESCE(qc.quality_score, 0),
    qc.award_type,
    qc.provider_family,
    d.readiness_score * 0.6 + COALESCE(qc.quality_score, 0) * 0.4
  FROM public.qualification_curriculum_drafts d
  JOIN public.qualification_catalog qc ON qc.id = d.qualification_catalog_id
  WHERE d.readiness_score >= p_min_readiness
    AND d.status IN ('ready', 'promoted')
    AND NOT EXISTS (
      SELECT 1 FROM public.qualification_wave_candidates wc
      WHERE wc.draft_id = d.id
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_synced = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'synced', v_synced);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_qualification_wave_candidates(numeric) TO service_role;

-- RLS: admin-only via service_role (no anon/authenticated access needed)
ALTER TABLE public.qualification_search_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_discovery_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_source_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_search_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_fetch_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intake_raw_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_curriculum_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_wave_candidates ENABLE ROW LEVEL SECURITY;
