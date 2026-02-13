
-- ============================================================
-- Rahmenplan-Ingest & Coverage Engine – Full Schema
-- ============================================================

-- 1) certification_documents: Quellenverwaltung pro Zertifizierung
CREATE TABLE IF NOT EXISTS public.certification_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('verordnung','rahmenplan','pruefungsordnung','strukturinfo','sonstiges')),
  source_kind text NOT NULL CHECK (source_kind IN ('url','pdf_upload')),
  source_url text,
  storage_path text,
  version_label text,
  issued_at date,
  checksum text,
  legal_priority int NOT NULL DEFAULT 50,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','draft')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cert_doc_source_check CHECK (source_url IS NOT NULL OR storage_path IS NOT NULL OR status = 'draft')
);
CREATE INDEX IF NOT EXISTS idx_cert_docs_cert ON public.certification_documents(certification_id);

ALTER TABLE public.certification_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read cert docs" ON public.certification_documents FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admin write cert docs" ON public.certification_documents FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

-- 2) curriculum_topics: Extracted topics per certification
CREATE TABLE IF NOT EXISTS public.curriculum_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL,
  topic_name text NOT NULL,
  topic_code text,
  description text,
  parent_topic_id uuid REFERENCES public.curriculum_topics(id) ON DELETE SET NULL,
  source_document_id uuid REFERENCES public.certification_documents(id) ON DELETE SET NULL,
  weight_percentage numeric,
  difficulty_level text CHECK (difficulty_level IS NULL OR difficulty_level IN ('easy','medium','hard')),
  learning_objectives text[],
  sort_order int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_cert ON public.curriculum_topics(certification_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_parent ON public.curriculum_topics(parent_topic_id);

ALTER TABLE public.curriculum_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read curriculum topics" ON public.curriculum_topics FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admin write curriculum topics" ON public.curriculum_topics FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

-- 3) curriculum_ingest_runs: Tracking for ingest jobs
CREATE TABLE IF NOT EXISTS public.curriculum_ingest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL,
  document_id uuid REFERENCES public.certification_documents(id) ON DELETE CASCADE,
  run_type text NOT NULL DEFAULT 'ingest' CHECK (run_type IN ('ingest','reingest','extract_only','normalize_only')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','failed')),
  error text,
  metrics jsonb DEFAULT '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ingest_runs_cert ON public.curriculum_ingest_runs(certification_id);
CREATE INDEX IF NOT EXISTS idx_ingest_runs_status ON public.curriculum_ingest_runs(status);

ALTER TABLE public.curriculum_ingest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read ingest runs" ON public.curriculum_ingest_runs FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admin write ingest runs" ON public.curriculum_ingest_runs FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

-- 4) curriculum_topic_coverage: Topic → Blueprint domain mapping
CREATE TABLE IF NOT EXISTS public.curriculum_topic_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL,
  topic_id uuid NOT NULL REFERENCES public.curriculum_topics(id) ON DELETE CASCADE,
  blueprint_domain_id uuid,
  blueprint_domain_key text,
  coverage_weight numeric NOT NULL DEFAULT 1.0,
  mapped boolean NOT NULL DEFAULT false,
  mapped_to jsonb,
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT topic_coverage_unique UNIQUE (certification_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_topic_coverage_cert ON public.curriculum_topic_coverage(certification_id);
CREATE INDEX IF NOT EXISTS idx_topic_coverage_mapped ON public.curriculum_topic_coverage(mapped);

ALTER TABLE public.curriculum_topic_coverage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read topic coverage" ON public.curriculum_topic_coverage FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admin write topic coverage" ON public.curriculum_topic_coverage FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

-- 5) coverage_snapshots: Point-in-time coverage measurements
CREATE TABLE IF NOT EXISTS public.coverage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL,
  snapshot_type text NOT NULL DEFAULT 'manual' CHECK (snapshot_type IN ('pre_exam_gen','post_exam_gen','audit','manual','auto')),
  overall_coverage numeric NOT NULL DEFAULT 0,
  by_domain jsonb DEFAULT '{}'::jsonb,
  missing_topics jsonb DEFAULT '[]'::jsonb,
  gate_status text NOT NULL DEFAULT 'pending' CHECK (gate_status IN ('pending','passed','failed','hold')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coverage_snapshots_cert ON public.coverage_snapshots(certification_id);

ALTER TABLE public.coverage_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read coverage snapshots" ON public.coverage_snapshots FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admin write coverage snapshots" ON public.coverage_snapshots FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

-- ============================================================
-- RPCs
-- ============================================================

-- 6) register_cert_document
CREATE OR REPLACE FUNCTION public.register_cert_document(
  p_certification_id uuid,
  p_doc_type text,
  p_source_kind text,
  p_source_url text DEFAULT NULL,
  p_storage_path text DEFAULT NULL,
  p_version_label text DEFAULT NULL,
  p_legal_priority int DEFAULT 50
) RETURNS uuid AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_doc_type NOT IN ('verordnung','rahmenplan','pruefungsordnung','strukturinfo','sonstiges') THEN
    RAISE EXCEPTION 'Invalid doc_type: %', p_doc_type;
  END IF;
  IF p_source_kind NOT IN ('url','pdf_upload') THEN
    RAISE EXCEPTION 'Invalid source_kind: %', p_source_kind;
  END IF;

  INSERT INTO public.certification_documents (
    certification_id, doc_type, source_kind, source_url, storage_path,
    version_label, legal_priority, status
  ) VALUES (
    p_certification_id, p_doc_type, p_source_kind, p_source_url, p_storage_path,
    p_version_label, p_legal_priority,
    CASE WHEN (p_source_url IS NOT NULL OR p_storage_path IS NOT NULL) THEN 'active' ELSE 'draft' END
  ) RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 7) start_curriculum_ingest
CREATE OR REPLACE FUNCTION public.start_curriculum_ingest(
  p_document_id uuid,
  p_run_type text DEFAULT 'ingest'
) RETURNS uuid AS $$
DECLARE
  v_cert_id uuid;
  v_run_id uuid;
BEGIN
  SELECT certification_id INTO v_cert_id FROM public.certification_documents WHERE id = p_document_id;
  IF v_cert_id IS NULL THEN
    RAISE EXCEPTION 'Document not found: %', p_document_id;
  END IF;
  
  INSERT INTO public.curriculum_ingest_runs (certification_id, document_id, run_type, status)
  VALUES (v_cert_id, p_document_id, p_run_type, 'queued')
  RETURNING id INTO v_run_id;
  
  RETURN v_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 8) compute_curriculum_coverage
CREATE OR REPLACE FUNCTION public.compute_curriculum_coverage(p_certification_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_total int;
  v_mapped int;
  v_overall numeric;
  v_by_domain jsonb;
  v_missing jsonb;
  v_gate text;
  v_snap_id uuid;
BEGIN
  -- Total topics for this cert
  SELECT COUNT(*) INTO v_total FROM public.curriculum_topics WHERE certification_id = p_certification_id;
  
  -- Mapped topics
  SELECT COUNT(*) INTO v_mapped FROM public.curriculum_topic_coverage
    WHERE certification_id = p_certification_id AND mapped = true;
  
  -- Overall coverage
  v_overall := CASE WHEN v_total = 0 THEN 0 ELSE (v_mapped::numeric / v_total::numeric) END;
  
  -- By domain
  SELECT COALESCE(jsonb_object_agg(
    COALESCE(blueprint_domain_key, 'unmapped'),
    jsonb_build_object(
      'total', cnt,
      'mapped', mapped_cnt,
      'coverage', CASE WHEN cnt = 0 THEN 0 ELSE (mapped_cnt::numeric / cnt::numeric) END
    )
  ), '{}'::jsonb) INTO v_by_domain
  FROM (
    SELECT 
      COALESCE(tc.blueprint_domain_key, 'unmapped') AS blueprint_domain_key,
      COUNT(*) AS cnt,
      COUNT(*) FILTER (WHERE tc.mapped) AS mapped_cnt
    FROM public.curriculum_topic_coverage tc
    WHERE tc.certification_id = p_certification_id
    GROUP BY COALESCE(tc.blueprint_domain_key, 'unmapped')
  ) sub;
  
  -- Missing topics
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'topic_id', ct.id,
    'topic_name', ct.topic_name,
    'topic_code', ct.topic_code
  )), '[]'::jsonb) INTO v_missing
  FROM public.curriculum_topics ct
  LEFT JOIN public.curriculum_topic_coverage tc ON tc.topic_id = ct.id AND tc.certification_id = p_certification_id
  WHERE ct.certification_id = p_certification_id
    AND (tc.id IS NULL OR tc.mapped = false);
  
  -- Gate status
  v_gate := CASE
    WHEN v_overall >= 0.95 THEN 'passed'
    WHEN v_overall >= 0.90 THEN 'passed'
    WHEN v_total = 0 THEN 'pending'
    ELSE 'failed'
  END;
  
  -- Write snapshot
  INSERT INTO public.coverage_snapshots (certification_id, snapshot_type, overall_coverage, by_domain, missing_topics, gate_status)
  VALUES (p_certification_id, 'auto', v_overall, v_by_domain, v_missing, v_gate)
  RETURNING id INTO v_snap_id;
  
  RETURN jsonb_build_object(
    'snapshot_id', v_snap_id,
    'total_topics', v_total,
    'mapped_topics', v_mapped,
    'overall_coverage', v_overall,
    'gate_status', v_gate,
    'by_domain', v_by_domain,
    'missing_count', jsonb_array_length(v_missing)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 9) set_curriculum_hold_if_needed
CREATE OR REPLACE FUNCTION public.set_curriculum_hold_if_needed(p_certification_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_coverage numeric;
  v_action text;
BEGIN
  SELECT overall_coverage INTO v_coverage FROM public.coverage_snapshots
    WHERE certification_id = p_certification_id
    ORDER BY created_at DESC LIMIT 1;
  
  IF v_coverage IS NULL THEN
    RETURN jsonb_build_object('action', 'no_data', 'coverage', 0);
  END IF;
  
  IF v_coverage < 0.90 THEN
    -- Set hold on blueprint
    UPDATE public.dom_blueprints SET status = 'draft'
      WHERE certification_id = p_certification_id AND status != 'locked';
    v_action := 'hold_set';
  ELSE
    v_action := 'clear';
  END IF;
  
  RETURN jsonb_build_object('action', v_action, 'coverage', v_coverage);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 10) Pilot Seed: Wirtschaftsfachwirt (IHK)
-- ============================================================

-- Dummy documents (draft status, no real source yet)
INSERT INTO public.certification_documents (certification_id, doc_type, source_kind, status, legal_priority, version_label)
VALUES
  ('c09b2c12-0c63-4d76-9544-4e1062eb59b6', 'verordnung', 'url', 'draft', 100, 'Placeholder'),
  ('c09b2c12-0c63-4d76-9544-4e1062eb59b6', 'rahmenplan', 'pdf_upload', 'draft', 80, 'Placeholder')
ON CONFLICT DO NOTHING;
