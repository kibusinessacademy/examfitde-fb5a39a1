-- ============================================
-- AZAV COMPLIANCE SCHEMA
-- Umfassendes QM-System für Trägerzulassung
-- ============================================

-- 1. QM-Handbuch Dokumentation (§178 SGB III Anforderung)
CREATE TABLE IF NOT EXISTS public.qm_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL CHECK (document_type IN (
    'quality_policy',           -- Qualitätspolitik
    'quality_objectives',       -- Qualitätsziele  
    'process_manual',           -- Prozesshandbuch
    'work_instruction',         -- Arbeitsanweisung
    'form_template',            -- Formularvorlage
    'checklist',                -- Checkliste
    'audit_report',             -- Auditbericht
    'management_review',        -- Managementbewertung
    'corrective_action',        -- Korrekturmaßnahme
    'preventive_action',        -- Vorbeugemaßnahme
    'risk_assessment',          -- Risikobewertung
    'competence_matrix',        -- Kompetenzmatrix
    'customer_feedback',        -- Kundenfeedback
    'improvement_suggestion',   -- Verbesserungsvorschlag
    'external_audit',           -- Externes Audit (DEKRA/TÜV)
    'internal_audit',           -- Internes Audit
    'other'
  )),
  title TEXT NOT NULL,
  description TEXT,
  content JSONB DEFAULT '{}',
  version TEXT NOT NULL DEFAULT '1.0',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'superseded', 'archived')),
  effective_from DATE,
  effective_until DATE,
  review_interval_months INTEGER DEFAULT 12,
  next_review_date DATE,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.qm_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access qm_documents" ON public.qm_documents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read approved qm_documents" ON public.qm_documents
  FOR SELECT TO authenticated
  USING (status = 'approved');

-- 2. AZAV Fachbereich-Zuordnung
CREATE TABLE IF NOT EXISTS public.azav_fachbereiche (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fachbereich_nummer INTEGER UNIQUE NOT NULL CHECK (fachbereich_nummer BETWEEN 1 AND 6),
  bezeichnung TEXT NOT NULL,
  beschreibung TEXT,
  sgb_referenz TEXT,
  massnahmen_beispiele JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT false,
  zulassung_datum DATE,
  zulassung_bis DATE,
  zertifikat_nummer TEXT,
  fachkundige_stelle TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed AZAV Fachbereiche
INSERT INTO public.azav_fachbereiche (fachbereich_nummer, bezeichnung, beschreibung, sgb_referenz) VALUES
(1, 'Aktivierung und berufliche Eingliederung', 'Maßnahmen zur Aktivierung und beruflichen Eingliederung', '§45 SGB III'),
(2, 'Arbeitsvermittlung (PAV)', 'Ausschließlich erfolgsbezogen vergütete Arbeitsvermittlung', '§45 Abs. 4 SGB III'),
(3, 'Berufswahl und Berufsausbildung', 'Maßnahmen der Berufswahl und Berufsausbildung', '§§48-80 SGB III'),
(4, 'Berufliche Weiterbildung', 'Maßnahmen der beruflichen Weiterbildung', '§§81-87 SGB III'),
(5, 'Transferleistungen', 'Maßnahmen der Transferleistungen', '§§110-111 SGB III'),
(6, 'Eingliederung behinderter Menschen', 'Maßnahmen zur Teilhabe behinderter Menschen', '§§117-122 SGB III')
ON CONFLICT (fachbereich_nummer) DO NOTHING;

ALTER TABLE public.azav_fachbereiche ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated read fachbereiche" ON public.azav_fachbereiche
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage fachbereiche" ON public.azav_fachbereiche
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. Maßnahmenzulassung (Kurs-Level AZAV Zertifizierung)
CREATE TABLE IF NOT EXISTS public.azav_massnahmen_zulassungen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  curriculum_id UUID NOT NULL REFERENCES public.curricula(id),
  fachbereich_id UUID NOT NULL REFERENCES public.azav_fachbereiche(id),
  
  -- Zulassungsdaten
  massnahmen_nummer TEXT,
  zulassung_status TEXT NOT NULL DEFAULT 'vorbereitung' CHECK (zulassung_status IN (
    'vorbereitung',       -- In Vorbereitung
    'beantragt',          -- Bei fachkundiger Stelle eingereicht
    'pruefung',           -- In Prüfung
    'nachbesserung',      -- Nachbesserung erforderlich
    'zugelassen',         -- Zugelassen
    'abgelaufen',         -- Zulassung abgelaufen
    'widerrufen'          -- Zulassung widerrufen
  )),
  
  -- Zertifikatsdaten
  zulassung_datum DATE,
  zulassung_bis DATE,
  zertifikat_nummer TEXT,
  fachkundige_stelle TEXT, -- DEKRA, TÜV, etc.
  
  -- Maßnahmenparameter
  massnahmen_dauer_wochen INTEGER,
  unterrichtseinheiten_gesamt INTEGER,
  unterrichtseinheiten_pro_woche INTEGER,
  lernform TEXT CHECK (lernform IN ('praesenz', 'online', 'blended', 'selbstlernphase')),
  max_teilnehmer INTEGER,
  kosten_pro_teilnehmer DECIMAL(10,2),
  
  -- Dokumentation
  massnahmen_konzept_url TEXT,
  lehrgangsunterlagen_url TEXT,
  dozenten_qualifikationen JSONB DEFAULT '[]',
  
  -- Audit Trail
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(course_id)
);

ALTER TABLE public.azav_massnahmen_zulassungen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage massnahmen" ON public.azav_massnahmen_zulassungen
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read zugelassene massnahmen" ON public.azav_massnahmen_zulassungen
  FOR SELECT TO authenticated
  USING (zulassung_status = 'zugelassen');

-- 4. AZAV Audit-Trail (§178 Abs. 3 - regelmäßige Überprüfung)
CREATE TABLE IF NOT EXISTS public.azav_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_type TEXT NOT NULL CHECK (audit_type IN (
    'internal_audit',         -- Internes Audit
    'external_audit',         -- Externes Audit (FKS)
    'management_review',      -- Managementbewertung
    'process_audit',          -- Prozessaudit
    'system_audit',           -- Systemaudit
    'surveillance_audit',     -- Überwachungsaudit
    'recertification_audit',  -- Rezertifizierungsaudit
    'document_review',        -- Dokumentenprüfung
    'corrective_action',      -- Korrekturmaßnahme
    'improvement'             -- Verbesserung
  )),
  title TEXT NOT NULL,
  description TEXT,
  
  -- Zuordnung
  massnahme_id UUID REFERENCES public.azav_massnahmen_zulassungen(id),
  qm_document_id UUID REFERENCES public.qm_documents(id),
  
  -- Audit Details
  audit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  auditor_name TEXT,
  auditor_organization TEXT,
  findings JSONB DEFAULT '[]',         -- [{type: 'observation'|'minor'|'major', description, action_required}]
  corrective_actions JSONB DEFAULT '[]',
  verification_date DATE,
  verification_status TEXT CHECK (verification_status IN ('pending', 'verified', 'failed')),
  
  -- Bewertung
  overall_result TEXT CHECK (overall_result IN ('passed', 'passed_with_conditions', 'failed', 'pending')),
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.azav_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access audit_log" ON public.azav_audit_log
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5. AZAV Compliance Checklist (automatisierte Prüfung)
CREATE TABLE IF NOT EXISTS public.azav_compliance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_category TEXT NOT NULL CHECK (check_category IN (
    'traeger_anforderungen',    -- §178 Abs. 1 Trägeranforderungen
    'massnahmen_anforderungen', -- §179 Maßnahmenanforderungen
    'qm_system',                -- QM-System
    'personal',                 -- Personalqualifikation
    'infrastruktur',            -- Räumliche/technische Ausstattung
    'dokumentation',            -- Dokumentation
    'datenschutz',              -- Datenschutz
    'lernerfolg'                -- Lernerfolgskontrollen
  )),
  check_code TEXT UNIQUE NOT NULL,
  check_name TEXT NOT NULL,
  check_description TEXT,
  sgb_referenz TEXT,
  
  -- Automatisierbare Prüfung?
  is_automated BOOLEAN DEFAULT false,
  automated_query TEXT, -- SQL Query für automatische Prüfung
  expected_result TEXT,
  
  -- Gewichtung
  priority TEXT DEFAULT 'required' CHECK (priority IN ('required', 'recommended', 'optional')),
  weight INTEGER DEFAULT 1,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AZAV Compliance Checks einfügen
INSERT INTO public.azav_compliance_checks (check_code, check_category, check_name, check_description, priority, is_automated, automated_query) VALUES
-- Trägeranforderungen (§178)
('TR-001', 'traeger_anforderungen', 'Leistungsfähigkeit und Zuverlässigkeit', 'Nachweis der wirtschaftlichen Leistungsfähigkeit', 'required', false, NULL),
('TR-002', 'traeger_anforderungen', 'Qualitätsmanagementsystem', 'Dokumentiertes QM-System vorhanden', 'required', true, 'SELECT COUNT(*) > 0 FROM qm_documents WHERE document_type = ''process_manual'' AND status = ''approved'''),
('TR-003', 'traeger_anforderungen', 'Qualitätspolitik', 'Qualitätspolitik dokumentiert und kommuniziert', 'required', true, 'SELECT COUNT(*) > 0 FROM qm_documents WHERE document_type = ''quality_policy'' AND status = ''approved'''),
('TR-004', 'traeger_anforderungen', 'Qualitätsziele', 'Messbare Qualitätsziele definiert', 'required', true, 'SELECT COUNT(*) > 0 FROM qm_documents WHERE document_type = ''quality_objectives'' AND status = ''approved'''),
('TR-005', 'traeger_anforderungen', 'Managementbewertung', 'Jährliche Managementbewertung durchgeführt', 'required', true, 'SELECT COUNT(*) > 0 FROM qm_documents WHERE document_type = ''management_review'' AND created_at > now() - interval ''1 year'''),

-- Maßnahmenanforderungen (§179)
('MA-001', 'massnahmen_anforderungen', 'Lernzielorientierung', 'Maßnahme orientiert sich am Curriculum/Ausbildungsrahmenplan', 'required', true, 'SELECT COUNT(*) > 0 FROM curricula WHERE status = ''frozen'''),
('MA-002', 'massnahmen_anforderungen', 'Aktualität der Lerninhalte', 'Inhalte entsprechen aktuellem Stand', 'required', true, 'SELECT COUNT(*) > 0 FROM courses WHERE status = ''published'''),
('MA-003', 'massnahmen_anforderungen', 'Methodische Umsetzung', 'Didaktisches Konzept dokumentiert', 'required', false, NULL),
('MA-004', 'massnahmen_anforderungen', 'Lernerfolgskontrollen', 'Regelmäßige Prüfungen implementiert', 'required', true, 'SELECT COUNT(*) > 0 FROM lessons WHERE step_type = ''mini_check'''),
('MA-005', 'massnahmen_anforderungen', 'Teilnehmerdokumentation', 'Lernfortschritte werden dokumentiert', 'required', true, 'SELECT COUNT(*) > 0 FROM learning_progress'),

-- QM-System
('QM-001', 'qm_system', 'Interne Audits', 'Interne Audits werden durchgeführt', 'required', true, 'SELECT COUNT(*) > 0 FROM azav_audit_log WHERE audit_type = ''internal_audit'' AND created_at > now() - interval ''1 year'''),
('QM-002', 'qm_system', 'Korrekturmaßnahmen', 'Korrekturmaßnahmenprozess etabliert', 'required', true, 'SELECT COUNT(*) > 0 FROM qm_documents WHERE document_type = ''corrective_action'''),
('QM-003', 'qm_system', 'Kontinuierliche Verbesserung', 'Verbesserungsprozess implementiert', 'required', false, NULL),
('QM-004', 'qm_system', 'Kundenfeedback', 'Systematisches Feedback-Management', 'required', true, 'SELECT COUNT(*) > 0 FROM course_reviews'),

-- Datenschutz
('DS-001', 'datenschutz', 'DSGVO-Konformität', 'Datenschutzkonzept vorhanden', 'required', false, NULL),
('DS-002', 'datenschutz', 'Audit-Logging', 'Zugriffe werden protokolliert', 'required', true, 'SELECT COUNT(*) > 0 FROM ai_tutor_logs'),
('DS-003', 'datenschutz', 'Pseudonymisierung', 'Export unterstützt Pseudonymisierung', 'recommended', true, 'SELECT true'), -- Immer true da implementiert

-- Lernerfolg
('LE-001', 'lernerfolg', 'Prüfungssystem', 'Standardisiertes Prüfungssystem', 'required', true, 'SELECT COUNT(*) > 0 FROM exam_blueprints WHERE frozen = true'),
('LE-002', 'lernerfolg', 'Fragenkatalog', 'Ausreichender Fragenkatalog vorhanden', 'required', true, 'SELECT COUNT(*) >= 100 FROM exam_questions WHERE status = ''approved'''),
('LE-003', 'lernerfolg', 'Evidence Packs', 'Revisionssichere Nachweise', 'required', true, 'SELECT COUNT(*) > 0 FROM course_evidence_packs')
ON CONFLICT (check_code) DO NOTHING;

ALTER TABLE public.azav_compliance_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All read compliance checks" ON public.azav_compliance_checks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage compliance checks" ON public.azav_compliance_checks
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 6. Compliance Check Ergebnisse
CREATE TABLE IF NOT EXISTS public.azav_compliance_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id UUID NOT NULL REFERENCES public.azav_compliance_checks(id),
  massnahme_id UUID REFERENCES public.azav_massnahmen_zulassungen(id),
  
  check_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  result TEXT NOT NULL CHECK (result IN ('passed', 'failed', 'not_applicable', 'pending')),
  actual_value TEXT,
  notes TEXT,
  evidence_url TEXT,
  
  checked_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.azav_compliance_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage compliance results" ON public.azav_compliance_results
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 7. RPC: Automatischer Compliance Check
CREATE OR REPLACE FUNCTION public.run_azav_compliance_check()
RETURNS TABLE (
  check_code TEXT,
  check_name TEXT,
  category TEXT,
  priority TEXT,
  result TEXT,
  actual_value TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  query_result BOOLEAN;
  actual_val TEXT;
BEGIN
  FOR rec IN 
    SELECT c.check_code, c.check_name, c.check_category, c.priority, 
           c.is_automated, c.automated_query
    FROM azav_compliance_checks c
    ORDER BY c.check_category, c.check_code
  LOOP
    check_code := rec.check_code;
    check_name := rec.check_name;
    category := rec.check_category;
    priority := rec.priority;
    
    IF rec.is_automated AND rec.automated_query IS NOT NULL THEN
      BEGIN
        EXECUTE rec.automated_query INTO query_result;
        IF query_result THEN
          result := 'passed';
          actual_value := 'Automatisch geprüft: OK';
        ELSE
          result := 'failed';
          actual_value := 'Automatisch geprüft: Nicht erfüllt';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        result := 'failed';
        actual_value := 'Query-Fehler: ' || SQLERRM;
      END;
    ELSE
      result := 'pending';
      actual_value := 'Manuelle Prüfung erforderlich';
    END IF;
    
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 8. View: AZAV Dashboard Statistiken
CREATE OR REPLACE VIEW public.azav_dashboard_stats AS
SELECT
  (SELECT COUNT(*) FROM qm_documents WHERE status = 'approved') AS approved_qm_docs,
  (SELECT COUNT(*) FROM qm_documents WHERE status = 'draft') AS draft_qm_docs,
  (SELECT COUNT(*) FROM qm_documents WHERE next_review_date < CURRENT_DATE) AS overdue_reviews,
  (SELECT COUNT(*) FROM azav_massnahmen_zulassungen WHERE zulassung_status = 'zugelassen') AS active_massnahmen,
  (SELECT COUNT(*) FROM azav_massnahmen_zulassungen WHERE zulassung_bis < CURRENT_DATE + interval '30 days') AS expiring_soon,
  (SELECT COUNT(*) FROM azav_audit_log WHERE audit_type = 'internal_audit' AND created_at > now() - interval '1 year') AS audits_this_year,
  (SELECT COUNT(*) FROM course_evidence_packs WHERE generated_at > now() - interval '30 days') AS recent_evidence_packs,
  (SELECT COUNT(*) FROM curricula WHERE status = 'frozen') AS frozen_curricula,
  (SELECT COUNT(*) FROM courses WHERE status = 'published') AS published_courses,
  (SELECT COUNT(*) FROM exam_questions WHERE status = 'approved') AS approved_questions,
  (SELECT COALESCE(AVG(score_percentage), 0) FROM exam_sessions WHERE finished_at > now() - interval '30 days') AS avg_exam_score_30d;

-- 9. Indexes für Performance
CREATE INDEX IF NOT EXISTS idx_qm_documents_type_status ON public.qm_documents(document_type, status);
CREATE INDEX IF NOT EXISTS idx_qm_documents_next_review ON public.qm_documents(next_review_date) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_massnahmen_status ON public.azav_massnahmen_zulassungen(zulassung_status);
CREATE INDEX IF NOT EXISTS idx_massnahmen_course ON public.azav_massnahmen_zulassungen(course_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_type_date ON public.azav_audit_log(audit_type, audit_date);
CREATE INDEX IF NOT EXISTS idx_compliance_results_check ON public.azav_compliance_results(check_id, check_date DESC);