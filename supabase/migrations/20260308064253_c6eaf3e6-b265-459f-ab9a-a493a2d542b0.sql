
-- ============================================
-- Curriculum Intake Engine Schema
-- ============================================

-- 1. Source Registry
CREATE TABLE IF NOT EXISTS public.curriculum_source_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE,
  source_type text NOT NULL,
  domain text NOT NULL,
  category text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  priority int NOT NULL DEFAULT 100,
  parser_strategy text NOT NULL,
  robots_checked boolean NOT NULL DEFAULT false,
  notes jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Intake Candidates
CREATE TABLE IF NOT EXISTS public.curriculum_intake_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_registry_id uuid REFERENCES public.curriculum_source_registry(id) ON DELETE SET NULL,
  source_key text NOT NULL,
  category text NOT NULL,
  title_raw text NOT NULL,
  provider_name text,
  canonical_title text,
  url text NOT NULL,
  document_url text,
  source_hash text,
  version_label text,
  version_date date,
  language text DEFAULT 'de',
  discovered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  intake_status text NOT NULL DEFAULT 'discovered',
  rejection_reason text,
  metadata jsonb,
  UNIQUE (url)
);

-- 3. Source Documents
CREATE TABLE IF NOT EXISTS public.curriculum_source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.curriculum_intake_candidates(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  storage_path text,
  source_url text NOT NULL,
  checksum_sha256 text,
  content_length bigint,
  http_status int,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  parse_status text NOT NULL DEFAULT 'pending',
  parser_name text,
  parser_version text,
  extracted_text jsonb,
  parse_error text
);

-- 4. Parsed Representation
CREATE TABLE IF NOT EXISTS public.curriculum_intake_parsed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL UNIQUE REFERENCES public.curriculum_intake_candidates(id) ON DELETE CASCADE,
  title_normalized text,
  education_type text NOT NULL,
  award_type text,
  regulation_reference text,
  source_authority text,
  curriculum_version text,
  curriculum_date date,
  certification_body text,
  exam_structure jsonb,
  learning_fields jsonb,
  competency_areas jsonb,
  admission_rules jsonb,
  weighting_rules jsonb,
  source_confidence numeric(5,2) DEFAULT 0,
  parsed_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Intake Jobs
CREATE TABLE IF NOT EXISTS public.curriculum_intake_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  candidate_id uuid REFERENCES public.curriculum_intake_candidates(id) ON DELETE CASCADE,
  source_document_id uuid REFERENCES public.curriculum_source_documents(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  run_after timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Promotion Log
CREATE TABLE IF NOT EXISTS public.curriculum_intake_promotion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.curriculum_intake_candidates(id) ON DELETE CASCADE,
  parsed_id uuid NOT NULL REFERENCES public.curriculum_intake_parsed(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE SET NULL,
  action text NOT NULL,
  reason text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.curriculum_source_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_intake_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_intake_parsed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_intake_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_intake_promotion_log ENABLE ROW LEVEL SECURITY;

-- Seed source registry
INSERT INTO public.curriculum_source_registry
(source_key, source_type, domain, category, priority, parser_strategy, robots_checked, notes)
VALUES
('kmk', 'official_pdf', 'kmk.org', 'dual', 10, 'kmk_pdf', true, '{"scope":"rahmenlehrplaene dual"}'),
('bibb', 'directory', 'bibb.de', 'dual', 20, 'bibb_directory', true, '{"scope":"anerkannte Ausbildungsberufe und Fortbildungsregelungen"}'),
('ihk', 'exam_info', 'ihk.de', 'fortbildung_ihk', 30, 'ihk_exam_meta', true, '{"scope":"Fachwirte, Meister IHK, Betriebswirte, Fortbildungspruefungen"}'),
('hwk', 'exam_info', 'hwk.de', 'fortbildung_hwk', 40, 'hwk_exam_meta', true, '{"scope":"Meisterpruefungen, Fortbildungspruefungen, Ada"}'),
('certification', 'official_html', 'various', 'certification', 90, 'generic_certification', false, '{"scope":"sonstige Zertifizierungen"}')
ON CONFLICT (source_key) DO NOTHING;

-- ============================================
-- RPCs
-- ============================================

-- Duplicate check
CREATE OR REPLACE FUNCTION public.find_existing_curriculum_match(
  p_title text,
  p_category text,
  p_version_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match record;
BEGIN
  SELECT c.id, c.title
  INTO v_match
  FROM public.curricula c
  WHERE lower(c.title) = lower(p_title)
  LIMIT 1;

  RETURN jsonb_build_object(
    'found', FOUND,
    'curriculum_id', v_match.id,
    'title', v_match.title
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_existing_curriculum_match(text,text,text) TO service_role;

-- Intake readiness check
CREATE OR REPLACE FUNCTION public.check_intake_candidate_readiness(
  p_candidate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p record;
  v_ready boolean := false;
BEGIN
  SELECT *
  INTO v_p
  FROM public.curriculum_intake_parsed
  WHERE candidate_id = p_candidate_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_parsed');
  END IF;

  v_ready :=
    (
      (v_p.education_type = 'dual_ausbildung' AND jsonb_array_length(COALESCE(v_p.learning_fields, '[]'::jsonb)) >= 8)
      OR
      (v_p.education_type IN ('ihk_fortbildung','hwk_fortbildung','certification') AND jsonb_array_length(COALESCE(v_p.competency_areas, '[]'::jsonb)) >= 5)
    )
    AND COALESCE(v_p.title_normalized, '') <> ''
    AND COALESCE(v_p.source_confidence, 0) >= 60;

  RETURN jsonb_build_object(
    'ok', true,
    'ready', v_ready,
    'education_type', v_p.education_type,
    'award_type', v_p.award_type,
    'learning_fields_count', jsonb_array_length(COALESCE(v_p.learning_fields, '[]'::jsonb)),
    'competency_areas_count', jsonb_array_length(COALESCE(v_p.competency_areas, '[]'::jsonb)),
    'source_confidence', v_p.source_confidence
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_intake_candidate_readiness(uuid) TO service_role;

-- Promote to curricula (uses actual curricula columns)
CREATE OR REPLACE FUNCTION public.promote_intake_candidate_to_curriculum(
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
  v_existing jsonb;
  v_curriculum_id uuid;
BEGIN
  SELECT * INTO v_c
  FROM public.curriculum_intake_candidates
  WHERE id = p_candidate_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'candidate_not_found');
  END IF;

  SELECT * INTO v_p
  FROM public.curriculum_intake_parsed
  WHERE candidate_id = p_candidate_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'parsed_missing');
  END IF;

  v_existing := public.find_existing_curriculum_match(v_p.title_normalized, v_c.category, v_c.version_label);

  IF COALESCE((v_existing->>'found')::boolean, false) THEN
    INSERT INTO public.curriculum_intake_promotion_log (
      candidate_id, parsed_id, curriculum_id, action, reason, details
    ) VALUES (
      p_candidate_id, v_p.id, (v_existing->>'curriculum_id')::uuid, 'skipped_duplicate', 'title_match', v_existing
    );

    UPDATE public.curriculum_intake_candidates
    SET intake_status = 'promoted'
    WHERE id = p_candidate_id;

    RETURN jsonb_build_object('ok', true, 'action', 'skipped_duplicate', 'curriculum_id', v_existing->>'curriculum_id');
  END IF;

  INSERT INTO public.curricula (
    title,
    track,
    import_source,
    normalized_data
  ) VALUES (
    v_p.title_normalized,
    'AUSBILDUNG_VOLL',
    'curriculum_intake',
    jsonb_build_object(
      'intake_candidate_id', p_candidate_id,
      'education_type', v_p.education_type,
      'award_type', v_p.award_type,
      'source_authority', v_p.source_authority,
      'curriculum_date', v_p.curriculum_date,
      'source_url', v_c.url
    )
  )
  RETURNING id INTO v_curriculum_id;

  INSERT INTO public.curriculum_intake_promotion_log (
    candidate_id, parsed_id, curriculum_id, action, reason, details
  ) VALUES (
    p_candidate_id, v_p.id, v_curriculum_id, 'created', 'intake_promoted', '{}'::jsonb
  );

  UPDATE public.curriculum_intake_candidates
  SET intake_status = 'promoted'
  WHERE id = p_candidate_id;

  RETURN jsonb_build_object('ok', true, 'action', 'created', 'curriculum_id', v_curriculum_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_intake_candidate_to_curriculum(uuid) TO service_role;

-- Claim intake jobs
CREATE OR REPLACE FUNCTION public.claim_curriculum_intake_jobs(
  p_job_type text,
  p_limit int DEFAULT 10,
  p_worker_id text DEFAULT 'default'
)
RETURNS TABLE (
  id uuid,
  job_type text,
  candidate_id uuid,
  source_document_id uuid,
  payload jsonb,
  attempts int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE public.curriculum_intake_jobs j
    SET status = 'processing',
        started_at = now(),
        attempts = j.attempts + 1,
        updated_at = now()
    WHERE j.id IN (
      SELECT j2.id FROM public.curriculum_intake_jobs j2
      WHERE j2.job_type = p_job_type
        AND j2.status IN ('pending', 'failed')
        AND j2.run_after <= now()
        AND j2.attempts < j2.max_attempts
      ORDER BY j2.created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING j.id, j.job_type, j.candidate_id, j.source_document_id, j.payload, j.attempts
  )
  SELECT * FROM claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_curriculum_intake_jobs(text,int,text) TO service_role;

-- Storage bucket for source documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('private-source-documents', 'private-source-documents', false)
ON CONFLICT (id) DO NOTHING;
