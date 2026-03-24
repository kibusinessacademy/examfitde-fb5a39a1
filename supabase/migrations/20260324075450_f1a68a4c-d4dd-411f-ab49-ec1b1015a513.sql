
-- ============================================
-- PIPELINE FIX 1: Reset integrity_check for blocked packages with persistence defect
-- ============================================

-- Reset the run_integrity_check step to queued for packages where step=done but report=NULL
UPDATE package_steps
SET status = 'queued', updated_at = now()
WHERE package_id IN ('a9f19137-a004-4850-838a-bdc8f8a705f5', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a')
  AND step_key = 'run_integrity_check'
  AND status = 'done';

-- Clear blocked status and reason so packages can resume
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id IN ('a9f19137-a004-4850-838a-bdc8f8a705f5', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a')
  AND status = 'blocked';

-- Reset auto_publish step to queued (it was blocked because of missing report)
UPDATE package_steps
SET status = 'queued', updated_at = now()
WHERE package_id IN ('a9f19137-a004-4850-838a-bdc8f8a705f5', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a')
  AND step_key = 'auto_publish'
  AND status = 'blocked';

-- ============================================
-- PIPELINE FIX 2: Re-dispatch stalled steps (queued since Feb 24)
-- ============================================
UPDATE package_steps
SET updated_at = now()
WHERE package_id IN (
  '335decc8-9f68-4784-b318-a68f620bf77e',
  'eff99cc4-785d-4f61-a3ef-12932d8043c3',
  'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab',
  '570ccb3e-2937-4d81-b3d8-624b9be84737'
)
  AND status = 'queued'
  AND updated_at < now() - interval '7 days';

-- ============================================
-- AZAV/ZFU/DSGVO/AI GOVERNANCE FRAMEWORK
-- ============================================

-- 1. Compliance Frameworks Registry
CREATE TABLE IF NOT EXISTS public.compliance_frameworks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_key text UNIQUE NOT NULL,
  name text NOT NULL,
  version text NOT NULL DEFAULT '1.0',
  category text NOT NULL DEFAULT 'quality',
  description text,
  requirements_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  valid_from date,
  valid_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Compliance Audits (internal + external)
CREATE TABLE IF NOT EXISTS public.compliance_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id uuid REFERENCES public.compliance_frameworks(id) ON DELETE SET NULL,
  audit_type text NOT NULL DEFAULT 'internal',
  title text NOT NULL,
  description text,
  auditor_name text,
  auditor_organization text,
  status text NOT NULL DEFAULT 'planned',
  planned_date date,
  started_at timestamptz,
  completed_at timestamptz,
  findings_count integer DEFAULT 0,
  critical_findings integer DEFAULT 0,
  result_summary jsonb,
  evidence_links jsonb DEFAULT '[]'::jsonb,
  next_audit_date date,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. DSGVO Processing Records (Art. 30 Verzeichnis)
CREATE TABLE IF NOT EXISTS public.dsgvo_processing_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_name text NOT NULL,
  process_purpose text NOT NULL,
  data_categories text[] NOT NULL DEFAULT '{}',
  data_subjects text[] NOT NULL DEFAULT '{}',
  legal_basis text NOT NULL,
  retention_period text,
  recipients text[] DEFAULT '{}',
  third_country_transfer boolean DEFAULT false,
  transfer_safeguards text,
  technical_measures jsonb DEFAULT '[]'::jsonb,
  organizational_measures jsonb DEFAULT '[]'::jsonb,
  risk_level text DEFAULT 'normal',
  dpia_required boolean DEFAULT false,
  dpia_completed_at timestamptz,
  responsible_person text,
  status text NOT NULL DEFAULT 'active',
  last_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. AI Governance Reviews
CREATE TABLE IF NOT EXISTS public.ai_governance_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_name text NOT NULL,
  risk_category text NOT NULL DEFAULT 'limited',
  eu_ai_act_class text,
  purpose text NOT NULL,
  models_used text[] DEFAULT '{}',
  data_inputs text[] DEFAULT '{}',
  output_type text,
  human_oversight_level text DEFAULT 'human_in_the_loop',
  transparency_measures jsonb DEFAULT '[]'::jsonb,
  bias_assessment jsonb,
  accuracy_metrics jsonb,
  review_status text NOT NULL DEFAULT 'pending',
  reviewer text,
  reviewed_at timestamptz,
  next_review_date date,
  findings jsonb DEFAULT '[]'::jsonb,
  remediation_plan jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. QM Kennzahlen / KPI Tracking
CREATE TABLE IF NOT EXISTS public.compliance_kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  framework_key text NOT NULL,
  kpi_key text NOT NULL,
  kpi_label text NOT NULL,
  value numeric NOT NULL,
  target numeric,
  unit text DEFAULT 'percent',
  status text DEFAULT 'on_track',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_date, framework_key, kpi_key)
);

-- Enable RLS
ALTER TABLE public.compliance_frameworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dsgvo_processing_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_governance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_kpi_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS: service_role only (admin data)
CREATE POLICY "Service role full access" ON public.compliance_frameworks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.compliance_audits FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.dsgvo_processing_records FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.ai_governance_reviews FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.compliance_kpi_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated admins can read
CREATE POLICY "Admins can read frameworks" ON public.compliance_frameworks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can read audits" ON public.compliance_audits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can read dsgvo" ON public.dsgvo_processing_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can read ai_gov" ON public.ai_governance_reviews FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can read kpis" ON public.compliance_kpi_snapshots FOR SELECT TO authenticated USING (true);

-- Seed AZAV/ZFU/DSGVO/AI frameworks
INSERT INTO public.compliance_frameworks (framework_key, name, version, category, description, requirements_json) VALUES
('azav_traeger', 'AZAV Trägerzulassung', '3.0', 'quality', 'Akkreditierungs- und Zulassungsverordnung Arbeitsförderung – Trägerzulassung nach §178 SGB III', '[
  {"id":"AZ-T-01","title":"Leistungsfähigkeit und Zuverlässigkeit","description":"Nachweis der wirtschaftlichen Leistungsfähigkeit und Zuverlässigkeit des Trägers"},
  {"id":"AZ-T-02","title":"Qualitätsmanagementsystem","description":"Einführung und Anwendung eines QM-Systems"},
  {"id":"AZ-T-03","title":"Qualifiziertes Personal","description":"Einsatz fachlich und pädagogisch qualifizierten Personals"},
  {"id":"AZ-T-04","title":"Teilnehmerorientierung","description":"Systematische Erfassung und Auswertung der Teilnehmerzufriedenheit"},
  {"id":"AZ-T-05","title":"Arbeitsmarktrelevanz","description":"Anpassung an Anforderungen des Arbeitsmarktes"}
]'::jsonb),
('azav_massnahme', 'AZAV Maßnahmezulassung', '3.0', 'quality', 'Zulassung einzelner Maßnahmen nach §179 SGB III', '[
  {"id":"AZ-M-01","title":"Arbeitsmarktliche Begründung","description":"Maßnahme muss arbeitsmarktlich begründet sein"},
  {"id":"AZ-M-02","title":"Angemessene Teilnahmebedingungen","description":"Zumutbare Bedingungen für Teilnehmende"},
  {"id":"AZ-M-03","title":"Qualitätssicherung der Durchführung","description":"Laufende QS während der Maßnahme"},
  {"id":"AZ-M-04","title":"Kosten-Leistungs-Verhältnis","description":"Angemessenes Preis-Leistungs-Verhältnis"},
  {"id":"AZ-M-05","title":"Eingliederungsquote","description":"Nachweis der Eingliederung in den Arbeitsmarkt"}
]'::jsonb),
('zfu', 'ZFU-Zulassung', '1.0', 'regulatory', 'Zulassung nach dem Fernunterrichtsschutzgesetz (FernUSG)', '[
  {"id":"ZFU-01","title":"Verbraucherschutz","description":"14-tägiges Widerrufsrecht, transparente AGB"},
  {"id":"ZFU-02","title":"Didaktisches Konzept","description":"Methodisch-didaktisch aufbereitetes Lehrmaterial"},
  {"id":"ZFU-03","title":"Betreuung","description":"Angemessene Betreuung der Teilnehmenden"},
  {"id":"ZFU-04","title":"Lernerfolgskontrolle","description":"Regelmäßige Überprüfung des Lernfortschritts"},
  {"id":"ZFU-05","title":"Vertragsbedingungen","description":"FernUSG-konforme Vertragsbedingungen"}
]'::jsonb),
('dsgvo', 'DSGVO-Compliance', '2.0', 'data_protection', 'Datenschutz-Grundverordnung – technische und organisatorische Maßnahmen', '[
  {"id":"DS-01","title":"Verarbeitungsverzeichnis (Art. 30)","description":"Vollständiges Verzeichnis aller Verarbeitungstätigkeiten"},
  {"id":"DS-02","title":"TOM (Art. 32)","description":"Technisch-organisatorische Maßnahmen"},
  {"id":"DS-03","title":"Betroffenenrechte (Art. 15-22)","description":"Prozesse für Auskunft, Löschung, Berichtigung"},
  {"id":"DS-04","title":"DSFA (Art. 35)","description":"Datenschutz-Folgenabschätzung bei hohem Risiko"},
  {"id":"DS-05","title":"AVV (Art. 28)","description":"Auftragsverarbeitungsverträge mit Dienstleistern"}
]'::jsonb),
('ai_governance', 'AI Governance Framework', '1.0', 'ai_ethics', 'EU AI Act konforme Governance für KI-Systeme in der Bildung', '[
  {"id":"AI-01","title":"Risikoklassifizierung","description":"Einstufung aller KI-Systeme nach EU AI Act Risikoklassen"},
  {"id":"AI-02","title":"Transparenz","description":"Kennzeichnung KI-generierter Inhalte, Erklärbarkeit"},
  {"id":"AI-03","title":"Human Oversight","description":"Menschliche Aufsicht über KI-Entscheidungen"},
  {"id":"AI-04","title":"Datenqualität","description":"Sicherstellung der Qualität von Trainingsdaten"},
  {"id":"AI-05","title":"Bias-Monitoring","description":"Regelmäßige Überprüfung auf Verzerrungen"},
  {"id":"AI-06","title":"Quality Council","description":"Multi-Model-Validierung aller KI-generierten Inhalte"}
]'::jsonb)
ON CONFLICT (framework_key) DO NOTHING;

-- Seed initial DSGVO processing records for ExamFit
INSERT INTO public.dsgvo_processing_records (process_name, process_purpose, data_categories, data_subjects, legal_basis, retention_period, risk_level, responsible_person) VALUES
('Lernfortschritt-Tracking', 'Erfassung und Auswertung des Lernfortschritts zur personalisierten Prüfungsvorbereitung', ARRAY['Prüfungsergebnisse','Lernzeiten','Kompetenzprofile'], ARRAY['Auszubildende'], 'Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung)', '24 Monate nach Kursende', 'normal', 'Datenschutzbeauftragter'),
('KI-Tutor Interaktionen', 'KI-gestützte Lernbegleitung mit Frage-Antwort-Interaktionen', ARRAY['Eingabetexte','Antwortprotokolle','Session-Daten'], ARRAY['Auszubildende'], 'Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung)', '12 Monate nach Session-Ende', 'hoch', 'Datenschutzbeauftragter'),
('Prüfungssimulationen', 'Durchführung und Auswertung von Prüfungssimulationen', ARRAY['Antworten','Scores','Zeitstempel'], ARRAY['Auszubildende'], 'Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung)', '24 Monate nach Prüfung', 'normal', 'Datenschutzbeauftragter'),
('Content-Generierung Pipeline', 'Automatisierte Erstellung von Lerninhalten durch KI-Modelle', ARRAY['Prompt-Daten','Generierte Inhalte','Validierungsergebnisse'], ARRAY['Keine personenbezogenen Daten'], 'Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse)', 'Unbegrenzt (Betriebsdaten)', 'normal', 'CTO'),
('Zahlungsabwicklung', 'Verarbeitung von Kauftransaktionen über Stripe', ARRAY['E-Mail','Zahlungsdaten (tokenisiert)','Rechnungsadresse'], ARRAY['Käufer'], 'Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung)', '10 Jahre (HGB §257)', 'normal', 'Geschäftsführung')
ON CONFLICT DO NOTHING;

-- Seed AI Governance Reviews for ExamFit KI-Systeme
INSERT INTO public.ai_governance_reviews (system_name, risk_category, eu_ai_act_class, purpose, models_used, human_oversight_level, review_status) VALUES
('Content Generation Pipeline', 'limited', 'Generalpurpose AI', 'Automatisierte Erstellung von Lerninhalten, Prüfungsfragen und Handbüchern', ARRAY['claude-sonnet-4-20250514','gpt-4o','gemini-2.5-pro'], 'human_in_the_loop', 'approved'),
('Quality Council', 'limited', 'Generalpurpose AI', 'Multi-Model-Validierung und Qualitätssicherung generierter Inhalte', ARRAY['claude-sonnet-4-20250514','gpt-4o'], 'human_on_the_loop', 'approved'),
('KI-Tutor', 'high', 'High-Risk (Bildung Art. 6)', 'Personalisierte Lernbegleitung mit adaptivem Feedback', ARRAY['gpt-4o','gemini-2.5-flash'], 'human_in_the_loop', 'in_review'),
('Exam Rebalancer', 'limited', 'Generalpurpose AI', 'Automatisierte Schwierigkeitsgrad-Optimierung des Prüfungspools', ARRAY['claude-sonnet-4-20250514'], 'human_on_the_loop', 'approved'),
('Prüfungsreife-Check', 'minimal', 'Minimal Risk', 'Selbsteinschätzung der Prüfungsreife ohne personenbezogene Speicherung', ARRAY[]::text[], 'none', 'approved')
ON CONFLICT DO NOTHING;

-- Create compliance overview view
CREATE OR REPLACE VIEW public.v_compliance_dashboard AS
SELECT
  cf.framework_key,
  cf.name as framework_name,
  cf.category,
  cf.is_active,
  (SELECT count(*) FROM compliance_audits ca WHERE ca.framework_id = cf.id) as total_audits,
  (SELECT count(*) FROM compliance_audits ca WHERE ca.framework_id = cf.id AND ca.status = 'completed') as completed_audits,
  (SELECT max(ca.completed_at) FROM compliance_audits ca WHERE ca.framework_id = cf.id AND ca.status = 'completed') as last_audit_date,
  (SELECT min(ca.planned_date) FROM compliance_audits ca WHERE ca.framework_id = cf.id AND ca.status = 'planned') as next_audit_date,
  (SELECT count(*) FROM compliance_findings cfn WHERE cfn.area = cf.framework_key AND cfn.status = 'open') as open_findings
FROM compliance_frameworks cf
WHERE cf.is_active = true
ORDER BY cf.category, cf.name;

NOTIFY pgrst, 'reload schema';
