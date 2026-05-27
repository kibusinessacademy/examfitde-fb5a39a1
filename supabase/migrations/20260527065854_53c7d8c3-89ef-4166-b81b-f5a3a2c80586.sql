
-- BerufAgentOS Cut 1: Vertical DNA + Outcome Bundles + Outcome Agent Team
CREATE TABLE IF NOT EXISTS public.vertical_dna (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_key    text NOT NULL UNIQUE,
  name            text NOT NULL,
  description     text,
  roles           text[] NOT NULL DEFAULT '{}',
  kpis            jsonb  NOT NULL DEFAULT '[]'::jsonb,
  risks           jsonb  NOT NULL DEFAULT '[]'::jsonb,
  pain_points     jsonb  NOT NULL DEFAULT '[]'::jsonb,
  sops            jsonb  NOT NULL DEFAULT '[]'::jsonb,
  automation_potential jsonb NOT NULL DEFAULT '[]'::jsonb,
  regulatory_context   jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.vertical_dna TO anon, authenticated;
GRANT ALL ON public.vertical_dna TO service_role;
ALTER TABLE public.vertical_dna ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vertical_dna_public_read_active" ON public.vertical_dna
  FOR SELECT TO anon, authenticated USING (is_active = true);
CREATE POLICY "vertical_dna_admin_all" ON public.vertical_dna
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_vertical_dna_updated
  BEFORE UPDATE ON public.vertical_dna
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.vertical_dna (industry_key, name, description, roles, kpis, risks, pain_points, sops, automation_potential, regulatory_context) VALUES
('public_admin', 'Öffentliche Verwaltung', 'Behörden, Kommunen, Ministerien — Aktenführung, Vier-Augen-Prinzip, Bürgeranfragen.',
  ARRAY['Sachbearbeiter','Amtsleiter','Datenschutzbeauftragter','IT-Koordinator'],
  '[{"key":"durchlaufzeit_antrag","label":"Durchlaufzeit Antrag (Tage)","target":7},{"key":"buergeranfragen_sla","label":"SLA Bürgeranfragen (%)","target":95}]',
  '[{"key":"datenschutz","label":"DSGVO-Verletzung","severity":"high"},{"key":"medienbruch","label":"Medienbruch Papier↔Digital","severity":"medium"}]',
  '[{"key":"manuelle_aktenfuehrung","label":"Manuelle Aktenführung"},{"key":"silos","label":"Fachsilos zwischen Ämtern"}]',
  '[{"key":"aktenanlage","label":"Akte anlegen + revisionssicher ablegen"}]',
  '[{"key":"klassifikation_eingang","label":"Eingangsklassifikation Posteingang","effort":"low","impact":"high"}]',
  '{"frameworks":["DSGVO","OZG","eIDAS"],"sensitivity":"high"}'::jsonb),
('hr', 'HR & People Operations', 'Personalwesen, Talent Acquisition, Mitarbeiterentwicklung.',
  ARRAY['HR-Business-Partner','Recruiter','People-Lead','Compensation-Lead'],
  '[{"key":"time_to_hire","label":"Time-to-Hire (Tage)","target":30},{"key":"retention_12m","label":"Retention 12 Monate (%)","target":85}]',
  '[{"key":"bias_screening","label":"Bias im Screening","severity":"high"}]',
  '[{"key":"manuelle_cv_sichtung","label":"Manuelle CV-Sichtung"}]',
  '[{"key":"onboarding","label":"30-60-90 Onboarding"}]',
  '[{"key":"job_description_draft","label":"Job-Description-Entwurf","effort":"low","impact":"high"}]',
  '{"frameworks":["DSGVO","AGG","EU AI Act (HR=high-risk)"],"sensitivity":"high"}'::jsonb),
('real_estate', 'Immobilienwirtschaft', 'Vermietung, Verwaltung, Asset-Management, Maklerwesen.',
  ARRAY['Property-Manager','Asset-Manager','Makler','Buchhalter'],
  '[{"key":"leerstandsquote","label":"Leerstand (%)","target":3},{"key":"miet_inkasso","label":"Miet-Inkasso (%)","target":98}]',
  '[{"key":"mietnomaden","label":"Zahlungsausfall","severity":"medium"}]',
  '[{"key":"manuelle_nebenkostenabrechnung","label":"Manuelle Nebenkostenabrechnung"}]',
  '[{"key":"mieterwechsel","label":"Mieterwechsel-Prozess"}]',
  '[{"key":"expose_erstellung","label":"Exposé-Erstellung","effort":"low","impact":"medium"}]',
  '{"frameworks":["BetrKV","MietRAnpG"],"sensitivity":"medium"}'::jsonb),
('healthcare', 'Healthcare & Pflege', 'Kliniken, Praxen, Pflegeeinrichtungen.',
  ARRAY['Pflegekraft','Arzt','MFA','Verwaltungsleitung'],
  '[{"key":"belegungsquote","label":"Belegungsquote (%)","target":90},{"key":"pflegezeit_doku","label":"Doku-Zeit pro Schicht (Min)","target":30}]',
  '[{"key":"behandlungsfehler","label":"Behandlungsfehler","severity":"critical"}]',
  '[{"key":"doppeldoku","label":"Doppeldokumentation"}]',
  '[{"key":"aufnahme","label":"Patientenaufnahme"}]',
  '[{"key":"arztbrief_entwurf","label":"Arztbrief-Entwurf","effort":"medium","impact":"high"}]',
  '{"frameworks":["DSGVO","SGB V","MDR","EU AI Act (medical=high-risk)"],"sensitivity":"critical"}'::jsonb),
('banking', 'Banking & Financial Services', 'Banken, Sparkassen, Versicherer, FinTech.',
  ARRAY['Kundenberater','Compliance-Officer','Kreditanalyst','Risikomanager'],
  '[{"key":"npl_ratio","label":"Non-Performing-Loan-Quote (%)","target":1.5},{"key":"kyc_durchlauf","label":"KYC-Durchlauf (Min)","target":15}]',
  '[{"key":"geldwaesche","label":"AML-Verstoß","severity":"critical"}]',
  '[{"key":"manuelle_kyc","label":"Manuelle KYC-Prüfung"}]',
  '[{"key":"kreditvergabe","label":"Kreditvergabe-Workflow"}]',
  '[{"key":"vertragsanalyse","label":"Vertragsanalyse","effort":"medium","impact":"high"}]',
  '{"frameworks":["MaRisk","KWG","DSGVO","EU AI Act (credit=high-risk)"],"sensitivity":"critical"}'::jsonb),
('crafts', 'Handwerk', 'Handwerksbetriebe, Bau, Sanitär, Elektro, Tischler.',
  ARRAY['Meister','Geselle','Disponent','Buchhalter'],
  '[{"key":"auftragsdurchlauf","label":"Auftragsdurchlauf (Tage)","target":10},{"key":"montagestunden_quote","label":"Produktivstunden (%)","target":75}]',
  '[{"key":"materialmangel","label":"Materialmangel auf Baustelle","severity":"medium"}]',
  '[{"key":"manuelle_angebote","label":"Manuelle Angebotserstellung"}]',
  '[{"key":"aufmass","label":"Aufmaß → Angebot"}]',
  '[{"key":"angebot_aus_aufmass","label":"Angebot aus Aufmaß generieren","effort":"low","impact":"high"}]',
  '{"frameworks":["HOAI","VOB"],"sensitivity":"low"}'::jsonb),
('education', 'Bildung & Weiterbildung', 'Schulen, Hochschulen, Bildungsträger, Akademien.',
  ARRAY['Dozent','Bildungsmanager','Curriculum-Lead','Pruefungsverantwortliche'],
  '[{"key":"abschlussquote","label":"Abschlussquote (%)","target":80},{"key":"nps_kurs","label":"Kurs-NPS","target":50}]',
  '[{"key":"pruefungsbetrug","label":"Prüfungsbetrug","severity":"medium"}]',
  '[{"key":"curriculum_drift","label":"Curriculum vs. Prüfungsrealität"}]',
  '[{"key":"pruefungserstellung","label":"Prüfungserstellung"}]',
  '[{"key":"lernzielcheck","label":"Lernzielcheck pro Modul","effort":"low","impact":"high"}]',
  '{"frameworks":["DSGVO","BBiG","SchulG"],"sensitivity":"medium"}'::jsonb),
('funding', 'Fördermittel & Beratung', 'Fördermittelberatung, EU-Programme, KfW, BAFA.',
  ARRAY['Foerdermittelberater','Antragsteller','Verwendungsnachweis-Lead'],
  '[{"key":"bewilligungsquote","label":"Bewilligungsquote (%)","target":70},{"key":"vn_p_quote","label":"VN pünktlich (%)","target":95}]',
  '[{"key":"rueckforderung","label":"Rückforderung","severity":"high"}]',
  '[{"key":"manuelle_antragsrecherche","label":"Manuelle Programmsuche"}]',
  '[{"key":"antragsstellung","label":"Antragsstellung"}]',
  '[{"key":"programm_matching","label":"Programm-Matching aus Projektskizze","effort":"low","impact":"high"}]',
  '{"frameworks":["ANBest-P","BHO","EU-Beihilferecht"],"sensitivity":"high"}'::jsonb),
('consulting', 'Consulting & Professional Services', 'Strategie, Management, IT-Beratung.',
  ARRAY['Consultant','Manager','Partner','Practice-Lead'],
  '[{"key":"utilization","label":"Utilization (%)","target":75},{"key":"realization","label":"Realization Rate (%)","target":90}]',
  '[{"key":"scope_creep","label":"Scope-Creep","severity":"medium"}]',
  '[{"key":"slide_factory","label":"Slide-Factory-Tätigkeiten"}]',
  '[{"key":"projektaufsatz","label":"Projektaufsatz"}]',
  '[{"key":"workshop_synthese","label":"Workshop-Synthese","effort":"medium","impact":"high"}]',
  '{"frameworks":["GDPR","Berufsverschwiegenheit"],"sensitivity":"high"}'::jsonb),
('support', 'Customer Support & Service', 'Support-Center, Service-Desk, Customer-Success.',
  ARRAY['Agent','Team-Lead','CS-Manager'],
  '[{"key":"frt","label":"First-Response-Time (Min)","target":15},{"key":"csat","label":"CSAT (%)","target":90}]',
  '[{"key":"eskalation","label":"Eskalation an Management","severity":"medium"}]',
  '[{"key":"copy_paste_antworten","label":"Copy-Paste-Antworten"}]',
  '[{"key":"ticket_triage","label":"Ticket-Triage"}]',
  '[{"key":"antwort_draft","label":"Antwort-Draft aus Wissensbasis","effort":"low","impact":"high"}]',
  '{"frameworks":["DSGVO","TKG"],"sensitivity":"medium"}'::jsonb)
ON CONFLICT (industry_key) DO NOTHING;

-- ============================================================
-- 2. OUTCOME BUNDLE SSOT
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.agent_outcome_review_status AS ENUM
    ('proposed','in_review','approved','rejected','applied','rolled_back');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.agent_outcome_artifact_kind AS ENUM
    ('sop','workflow','api_contract','ui_spec','dashboard','test','seo_brief','compliance_note','business_case','roadmap');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.agent_outcome_bundles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid REFERENCES public.berufs_ki_agent_runs(id) ON DELETE SET NULL,
  user_id         uuid,
  outcome_goal    text NOT NULL,
  vertical_key    text NOT NULL REFERENCES public.vertical_dna(industry_key) ON DELETE RESTRICT,
  curriculum_id   uuid,
  business_case   jsonb NOT NULL DEFAULT '{}'::jsonb,
  process_model   jsonb NOT NULL DEFAULT '{}'::jsonb,
  kpi_impact      jsonb NOT NULL DEFAULT '[]'::jsonb,
  workflow_graph  jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_register   jsonb NOT NULL DEFAULT '[]'::jsonb,
  sops            jsonb NOT NULL DEFAULT '[]'::jsonb,
  roadmap         jsonb NOT NULL DEFAULT '[]'::jsonb,
  rollout_plan    jsonb NOT NULL DEFAULT '{}'::jsonb,
  dashboard_spec  jsonb NOT NULL DEFAULT '{}'::jsonb,
  test_matrix     jsonb NOT NULL DEFAULT '[]'::jsonb,
  rollback_plan   jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_team      text[] NOT NULL DEFAULT '{}',
  agent_outputs   jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_status   public.agent_outcome_review_status NOT NULL DEFAULT 'proposed',
  review_reason   text,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  confidence      numeric(4,3),
  completeness_pct numeric(5,2) GENERATED ALWAYS AS (
    (
      (CASE WHEN business_case  <> '{}'::jsonb THEN 1 ELSE 0 END) +
      (CASE WHEN process_model  <> '{}'::jsonb THEN 1 ELSE 0 END) +
      (CASE WHEN jsonb_array_length(kpi_impact)    > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN workflow_graph <> '{}'::jsonb THEN 1 ELSE 0 END) +
      (CASE WHEN jsonb_array_length(risk_register) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN jsonb_array_length(sops)          > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN jsonb_array_length(roadmap)       > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN rollout_plan   <> '{}'::jsonb THEN 1 ELSE 0 END) +
      (CASE WHEN dashboard_spec <> '{}'::jsonb THEN 1 ELSE 0 END) +
      (CASE WHEN jsonb_array_length(test_matrix)   > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN rollback_plan  <> '{}'::jsonb THEN 1 ELSE 0 END)
    )::numeric * 100.0 / 11.0
  ) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.agent_outcome_bundles TO authenticated;
GRANT ALL ON public.agent_outcome_bundles TO service_role;

ALTER TABLE public.agent_outcome_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outcome_bundles_admin_all" ON public.agent_outcome_bundles
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "outcome_bundles_owner_read" ON public.agent_outcome_bundles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_outcome_bundles_vertical ON public.agent_outcome_bundles(vertical_key);
CREATE INDEX IF NOT EXISTS idx_outcome_bundles_status   ON public.agent_outcome_bundles(review_status);
CREATE INDEX IF NOT EXISTS idx_outcome_bundles_created  ON public.agent_outcome_bundles(created_at DESC);

CREATE TRIGGER trg_outcome_bundles_updated
  BEFORE UPDATE ON public.agent_outcome_bundles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.fn_validate_outcome_bundle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF length(trim(NEW.outcome_goal)) < 8 THEN
    RAISE EXCEPTION 'outcome_goal must be at least 8 chars (got %)', length(trim(NEW.outcome_goal));
  END IF;
  IF NEW.workflow_graph ? 'nodes'
     AND jsonb_array_length(COALESCE(NEW.workflow_graph->'nodes','[]'::jsonb)) > 0
     AND jsonb_array_length(NEW.kpi_impact) = 0 THEN
    RAISE EXCEPTION 'workflow_graph with nodes requires at least one kpi_impact entry';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_validate_outcome_bundle
  BEFORE INSERT OR UPDATE ON public.agent_outcome_bundles
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_outcome_bundle();

-- ============================================================
-- 3. OUTCOME ARTIFACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_outcome_artifacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id     uuid NOT NULL REFERENCES public.agent_outcome_bundles(id) ON DELETE CASCADE,
  kind          public.agent_outcome_artifact_kind NOT NULL,
  title         text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  export_format text NOT NULL DEFAULT 'json',
  sha256        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.agent_outcome_artifacts TO authenticated;
GRANT ALL ON public.agent_outcome_artifacts TO service_role;
ALTER TABLE public.agent_outcome_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outcome_artifacts_admin_all" ON public.agent_outcome_artifacts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "outcome_artifacts_owner_read" ON public.agent_outcome_artifacts
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.agent_outcome_bundles b
            WHERE b.id = bundle_id AND b.user_id = auth.uid())
  );
CREATE INDEX IF NOT EXISTS idx_outcome_artifacts_bundle ON public.agent_outcome_artifacts(bundle_id);
CREATE INDEX IF NOT EXISTS idx_outcome_artifacts_kind   ON public.agent_outcome_artifacts(kind);

-- ============================================================
-- 4. RPCs
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_outcome_bundles(
  _vertical text DEFAULT NULL,
  _status   public.agent_outcome_review_status DEFAULT NULL,
  _limit    int DEFAULT 100
)
RETURNS TABLE (
  id uuid, outcome_goal text, vertical_key text, review_status public.agent_outcome_review_status,
  confidence numeric, completeness_pct numeric, agent_team text[],
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.outcome_goal, b.vertical_key, b.review_status,
         b.confidence, b.completeness_pct, b.agent_team,
         b.created_at, b.updated_at
  FROM public.agent_outcome_bundles b
  WHERE has_role(auth.uid(), 'admin'::app_role)
    AND (_vertical IS NULL OR b.vertical_key = _vertical)
    AND (_status   IS NULL OR b.review_status = _status)
  ORDER BY b.created_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 500));
$$;

CREATE OR REPLACE FUNCTION public.admin_get_outcome_bundle(_bundle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'bundle', to_jsonb(b),
    'vertical', to_jsonb(v),
    'artifacts', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at)
                           FROM public.agent_outcome_artifacts a
                           WHERE a.bundle_id = b.id), '[]'::jsonb)
  )
  INTO result
  FROM public.agent_outcome_bundles b
  LEFT JOIN public.vertical_dna v ON v.industry_key = b.vertical_key
  WHERE b.id = _bundle_id;
  IF result IS NULL THEN RAISE EXCEPTION 'bundle_not_found'; END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.admin_decide_outcome_bundle(
  _bundle_id uuid, _decision text, _reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new public.agent_outcome_review_status;
  v_audit text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF length(trim(coalesce(_reason,''))) < 8 THEN
    RAISE EXCEPTION 'reason must be at least 8 chars';
  END IF;
  v_new := CASE _decision
    WHEN 'approve'   THEN 'approved'::public.agent_outcome_review_status
    WHEN 'reject'    THEN 'rejected'::public.agent_outcome_review_status
    WHEN 'apply'     THEN 'applied'::public.agent_outcome_review_status
    WHEN 'rollback'  THEN 'rolled_back'::public.agent_outcome_review_status
    WHEN 'in_review' THEN 'in_review'::public.agent_outcome_review_status
    ELSE NULL END;
  IF v_new IS NULL THEN RAISE EXCEPTION 'invalid decision %', _decision; END IF;

  UPDATE public.agent_outcome_bundles
     SET review_status = v_new, review_reason = _reason,
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = _bundle_id;

  v_audit := 'outcome_bundle_' || _decision;
  BEGIN
    PERFORM public.fn_emit_audit(v_audit,
      jsonb_build_object('bundle_id', _bundle_id, 'actor', auth.uid(), 'reason', _reason));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
    VALUES (v_audit, 'agent_outcome_bundle', 'success',
            jsonb_build_object('bundle_id', _bundle_id, 'actor', auth.uid(), 'reason', _reason));
  END;

  RETURN jsonb_build_object('id', _bundle_id, 'status', v_new);
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_vertical_dna(_industry_key text DEFAULT NULL)
RETURNS SETOF public.vertical_dna
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.vertical_dna
  WHERE has_role(auth.uid(), 'admin'::app_role)
    AND (_industry_key IS NULL OR industry_key = _industry_key)
  ORDER BY name;
$$;

CREATE OR REPLACE FUNCTION public.admin_outcome_control_center()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'bundles', jsonb_build_object(
      'total',        (SELECT count(*) FROM public.agent_outcome_bundles),
      'proposed',     (SELECT count(*) FROM public.agent_outcome_bundles WHERE review_status = 'proposed'),
      'in_review',    (SELECT count(*) FROM public.agent_outcome_bundles WHERE review_status = 'in_review'),
      'approved',     (SELECT count(*) FROM public.agent_outcome_bundles WHERE review_status = 'approved'),
      'applied',      (SELECT count(*) FROM public.agent_outcome_bundles WHERE review_status = 'applied'),
      'rejected',     (SELECT count(*) FROM public.agent_outcome_bundles WHERE review_status = 'rejected'),
      'rolled_back',  (SELECT count(*) FROM public.agent_outcome_bundles WHERE review_status = 'rolled_back'),
      'avg_confidence',   (SELECT round(avg(confidence)::numeric, 3) FROM public.agent_outcome_bundles WHERE confidence IS NOT NULL),
      'avg_completeness', (SELECT round(avg(completeness_pct)::numeric, 1) FROM public.agent_outcome_bundles)
    ),
    'verticals', jsonb_build_object(
      'total',  (SELECT count(*) FROM public.vertical_dna WHERE is_active),
      'active', (SELECT count(DISTINCT vertical_key) FROM public.agent_outcome_bundles)
    ),
    'agent_team', (SELECT jsonb_agg(jsonb_build_object(
        'slug', a.slug, 'name', a.name, 'category', a.category,
        'runs_24h', COALESCE((SELECT count(*) FROM public.berufs_ki_agent_runs r
                              WHERE r.agent_id = a.id AND r.created_at > now() - interval '24 hours'), 0),
        'requires_approval', a.requires_human_approval,
        'is_active', a.is_active
      ) ORDER BY a.slug)
      FROM public.berufs_ki_agents a
      WHERE a.slug LIKE 'outcome-%' OR a.slug LIKE '%-agent')
  ) INTO r;
  RETURN r;
END $$;

-- ============================================================
-- 5. SEED 10 OUTCOME AGENTS
-- ============================================================
INSERT INTO public.berufs_ki_agents (slug, name, description, category, role, requires_human_approval, confidence_threshold, governance_rules, runtime_profile)
VALUES
('outcome-strategy','Strategy Agent','Business Case, ROI, Roadmap, Priorisierung, Marktpotenzial, Make-or-Buy.','analysis','Strategieberater',true,0.75,
 '{"outcome_contract":["business_case","roadmap","kpi_impact"],"layer":"strategy"}'::jsonb,'{"model":"openai/gpt-5.4","reasoning":"high"}'::jsonb),
('outcome-product','Product Agent','Produktkonzept, Scope, User Stories, Pricing, Onboarding, Monetarisierung.','industry','Product Lead',true,0.75,
 '{"outcome_contract":["business_case","rollout_plan","dashboard_spec"],"layer":"product"}'::jsonb,'{"model":"openai/gpt-5.4"}'::jsonb),
('outcome-workflow','Workflow Agent','Trigger, Statuslogik, SLAs, Eskalationen, Prozessgrafen, Automatisierungen.','workflow','Process Architect',true,0.75,
 '{"outcome_contract":["process_model","workflow_graph","kpi_impact"],"layer":"workflow"}'::jsonb,'{"model":"google/gemini-3.5-flash"}'::jsonb),
('outcome-build','Build Agent','Features, APIs, Datenmodelle, UI-Komponenten, Tests, PR-Plan, Rollback.','operations','Engineering Lead',true,0.8,
 '{"outcome_contract":["test_matrix","rollback_plan","sops"],"layer":"build"}'::jsonb,'{"model":"openai/gpt-5.4"}'::jsonb),
('outcome-ux','UX Agent','Premium UX, Persona-Flows, Dashboards, Empty States, Microcopy, Onboarding.','industry','UX Director',true,0.7,
 '{"outcome_contract":["dashboard_spec","rollout_plan"],"layer":"ux"}'::jsonb,'{"model":"google/gemini-3.5-flash"}'::jsonb),
('outcome-seo-authority','SEO Authority Agent','Pillar Pages, Cluster, FAQ, Schema.org, Linkgraph, Wachstumslogik.','industry','SEO Authority',true,0.7,
 '{"outcome_contract":["roadmap","dashboard_spec"],"layer":"seo"}'::jsonb,'{"model":"google/gemini-3.5-flash"}'::jsonb),
('outcome-growth','Growth Agent','Funnel, Referral Loops, CTAs, Conversion-Logik, Pricing-Experimente.','industry','Growth Lead',true,0.7,
 '{"outcome_contract":["business_case","kpi_impact","dashboard_spec"],"layer":"growth"}'::jsonb,'{"model":"google/gemini-3.5-flash"}'::jsonb),
('outcome-security','Security Agent','RLS, Rollenrechte, Secret-Leak-Scans, Risikoanalyse, Fix-Patches.','compliance','Security Officer',true,0.85,
 '{"outcome_contract":["risk_register","test_matrix","rollback_plan"],"layer":"security"}'::jsonb,'{"model":"openai/gpt-5.4"}'::jsonb),
('outcome-compliance','Compliance Agent','DSGVO, EU AI Act, Consent-Flows, Audit-Trails, Risiko-Klassifizierung.','compliance','Compliance Officer',true,0.85,
 '{"outcome_contract":["risk_register","sops"],"layer":"compliance"}'::jsonb,'{"model":"openai/gpt-5.4"}'::jsonb),
('outcome-executive','Executive Agent','Entscheidungsvorlagen, KPI-Wirkung, Budget, Risiko, Go/No-Go.','analysis','Executive Sponsor',true,0.8,
 '{"outcome_contract":["business_case","risk_register","roadmap"],"layer":"executive"}'::jsonb,'{"model":"openai/gpt-5.4","reasoning":"high"}'::jsonb)
ON CONFLICT (slug) DO UPDATE
SET governance_rules = EXCLUDED.governance_rules,
    runtime_profile  = EXCLUDED.runtime_profile,
    description      = EXCLUDED.description,
    updated_at       = now();

-- ============================================================
-- 6. AUDIT CONTRACTS
-- ============================================================
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('vertical_dna_seeded',      ARRAY['industry_key']::text[], 'berufagentos'),
  ('outcome_bundle_created',   ARRAY['bundle_id','vertical_key']::text[], 'berufagentos'),
  ('outcome_bundle_approve',   ARRAY['bundle_id','actor','reason']::text[], 'berufagentos'),
  ('outcome_bundle_reject',    ARRAY['bundle_id','actor','reason']::text[], 'berufagentos'),
  ('outcome_bundle_apply',     ARRAY['bundle_id','actor','reason']::text[], 'berufagentos'),
  ('outcome_bundle_rollback',  ARRAY['bundle_id','actor','reason']::text[], 'berufagentos'),
  ('outcome_bundle_in_review', ARRAY['bundle_id','actor','reason']::text[], 'berufagentos')
ON CONFLICT (action_type) DO NOTHING;
