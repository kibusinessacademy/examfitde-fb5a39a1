
CREATE TABLE IF NOT EXISTS public.document_agent_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  profession_id uuid,
  company_name text NOT NULL,
  legal_name text,
  address text,
  billing_address text,
  contact_email text,
  phone text,
  website text,
  logo_url text,
  brand_colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  font_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_sender_name text,
  default_sender_role text,
  default_signature text,
  tone_of_voice text NOT NULL DEFAULT 'professionell',
  compliance_level text NOT NULL DEFAULT 'standard' CHECK (compliance_level IN ('standard','sensitive','regulated')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (organization_id IS NOT NULL OR user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_dap_org ON public.document_agent_profiles(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dap_user ON public.document_agent_profiles(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.document_agent_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  document_type text NOT NULL,
  category text NOT NULL,
  profession_id uuid,
  curriculum_id uuid REFERENCES public.course_packages(id) ON DELETE SET NULL,
  competency_id uuid,
  blueprint_id uuid,
  required_inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  optional_inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  template_structure jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  compliance_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  system_prompt text NOT NULL,
  user_prompt_template text NOT NULL,
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high')),
  review_required boolean NOT NULL DEFAULT false,
  tier_required text NOT NULL DEFAULT 'free' CHECK (tier_required IN ('free','pro','business')),
  model_recommendation text NOT NULL DEFAULT 'google/gemini-2.5-flash',
  is_active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dat_type ON public.document_agent_templates(document_type, is_active);
CREATE INDEX IF NOT EXISTS idx_dat_profession ON public.document_agent_templates(profession_id) WHERE profession_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.document_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  template_id uuid NOT NULL REFERENCES public.document_agent_templates(id) ON DELETE RESTRICT,
  profile_id uuid REFERENCES public.document_agent_profiles(id) ON DELETE SET NULL,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_document text,
  structured_sections jsonb NOT NULL DEFAULT '{}'::jsonb,
  compliance_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_information jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_score numeric(4,3),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generating','generated','needs_review','approved','exported','archived','failed')),
  review_required boolean NOT NULL DEFAULT false,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  export_format text,
  model_used text,
  duration_ms int,
  error_message text,
  audit_trail jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dar_user ON public.document_agent_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dar_org ON public.document_agent_runs(organization_id, created_at DESC) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dar_template ON public.document_agent_runs(template_id);

ALTER TABLE public.document_agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_agent_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY dap_select ON public.document_agent_profiles FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR (organization_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.org_memberships om
    WHERE om.org_id = document_agent_profiles.organization_id AND om.user_id = auth.uid() AND om.status = 'active'
  ))
  OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY dap_insert ON public.document_agent_profiles FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid()
  OR (organization_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.org_memberships om
    WHERE om.org_id = document_agent_profiles.organization_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin') AND om.status = 'active'
  ))
);
CREATE POLICY dap_update ON public.document_agent_profiles FOR UPDATE TO authenticated USING (
  user_id = auth.uid()
  OR (organization_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.org_memberships om
    WHERE om.org_id = document_agent_profiles.organization_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin') AND om.status = 'active'
  ))
  OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY dap_delete ON public.document_agent_profiles FOR DELETE TO authenticated USING (
  user_id = auth.uid() OR public.has_role(auth.uid(),'admin')
);

CREATE POLICY dat_select ON public.document_agent_templates FOR SELECT TO authenticated USING (
  is_active OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY dat_admin_all ON public.document_agent_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY dar_select ON public.document_agent_runs FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR (organization_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.org_memberships om
    WHERE om.org_id = document_agent_runs.organization_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin') AND om.status = 'active'
  ))
  OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY dar_update ON public.document_agent_runs FOR UPDATE TO authenticated USING (
  user_id = auth.uid()
  OR (organization_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.org_memberships om
    WHERE om.org_id = document_agent_runs.organization_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin') AND om.status = 'active'
  ))
  OR public.has_role(auth.uid(),'admin')
);

CREATE OR REPLACE FUNCTION public.tg_doc_agent_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_dap_touch BEFORE UPDATE ON public.document_agent_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_doc_agent_touch_updated_at();
CREATE TRIGGER trg_dat_touch BEFORE UPDATE ON public.document_agent_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_doc_agent_touch_updated_at();
CREATE TRIGGER trg_dar_touch BEFORE UPDATE ON public.document_agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_doc_agent_touch_updated_at();

CREATE OR REPLACE FUNCTION public.tg_bki_sync_document_template_node()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.berufs_ki_graph_nodes (node_type, title, description, profession_id, source_system, source_ref_id, metadata)
  VALUES ('document_type'::berufs_ki_graph_node_type, NEW.title, NEW.description, NEW.profession_id, 'document_template', NEW.id,
          jsonb_build_object('slug', NEW.slug, 'document_type', NEW.document_type, 'category', NEW.category, 'risk_level', NEW.risk_level))
  ON CONFLICT (node_type, source_system, source_ref_id) DO UPDATE
    SET title = EXCLUDED.title, description = EXCLUDED.description, metadata = EXCLUDED.metadata, updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_bki_sync_doc_template AFTER INSERT OR UPDATE ON public.document_agent_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_bki_sync_document_template_node();

CREATE OR REPLACE FUNCTION public.admin_doc_agent_list_templates()
RETURNS TABLE (
  id uuid, slug text, title text, document_type text, category text,
  risk_level text, tier_required text, review_required boolean,
  is_active boolean, version int, runs_total bigint, last_run_at timestamptz,
  updated_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, t.title, t.document_type, t.category,
         t.risk_level, t.tier_required, t.review_required,
         t.is_active, t.version,
         COALESCE(r.runs_total, 0) AS runs_total,
         r.last_run_at,
         t.updated_at
  FROM public.document_agent_templates t
  LEFT JOIN (
    SELECT template_id, COUNT(*) AS runs_total, MAX(created_at) AS last_run_at
    FROM public.document_agent_runs GROUP BY template_id
  ) r ON r.template_id = t.id
  WHERE public.has_role(auth.uid(),'admin')
  ORDER BY t.category, t.title;
$$;
REVOKE ALL ON FUNCTION public.admin_doc_agent_list_templates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_doc_agent_list_templates() TO authenticated;

INSERT INTO public.document_agent_templates
(slug, title, description, document_type, category, risk_level, review_required, tier_required,
 required_inputs, output_sections, compliance_rules, system_prompt, user_prompt_template)
VALUES
('doc-kundenanschreiben','Kundenanschreiben','Professionelles Kundenanschreiben mit Anlass, Empfänger und Ziel.','kundenanschreiben','kommunikation','low',false,'free',
 '[{"key":"empfaenger","label":"Empfänger","type":"text","required":true},{"key":"anlass","label":"Anlass","type":"textarea","required":true},{"key":"ziel","label":"Ziel des Schreibens","type":"text","required":true}]'::jsonb,
 '["briefkopf","betreff","anrede","hauptteil","schluss","signatur"]'::jsonb,
 '{"check_pii":true,"require_signature":true}'::jsonb,
 'Du bist ein professioneller Geschäftsbriefschreiber. Erzeuge ein klares, höfliches Kundenanschreiben in deutscher Sprache. Vermeide rechtliche Zusagen. Strukturiere mit Anrede, Betreff, Hauptteil, Schluss.',
 'Anlass: {{anlass}}\nEmpfänger: {{empfaenger}}\nZiel: {{ziel}}\nTonalität: {{tone_of_voice}}\nAbsender: {{company_name}}, {{default_sender_name}}'),
('doc-beschwerdeantwort','Beschwerdeantwort','Empathische, lösungsorientierte Antwort auf Kundenbeschwerden.','beschwerdeantwort','kommunikation','medium',true,'pro',
 '[{"key":"beschwerde","label":"Beschwerdeinhalt","type":"textarea","required":true},{"key":"loesung","label":"Vorgeschlagene Lösung","type":"textarea","required":true}]'::jsonb,
 '["betreff","anrede","verstaendnis","sachverhalt","loesung","ausblick","signatur"]'::jsonb,
 '{"check_pii":true,"require_review":true,"avoid_admission_of_liability":true}'::jsonb,
 'Du beantwortest Kundenbeschwerden professionell, empathisch und lösungsorientiert. Vermeide juristische Schuldanerkenntnisse. Markiere unklare Sachverhalte als zu prüfen.',
 'Beschwerde: {{beschwerde}}\nLösungsvorschlag: {{loesung}}\nAbsender: {{company_name}}'),
('doc-mahnung','Mahnung (Zahlungserinnerung)','Höfliche Zahlungserinnerung mit klarer Frist.','mahnung','kommunikation','high',true,'pro',
 '[{"key":"rechnungsnummer","label":"Rechnungsnummer","type":"text","required":true},{"key":"betrag","label":"Offener Betrag","type":"text","required":true},{"key":"faelligkeit","label":"Ursprüngliches Fälligkeitsdatum","type":"text","required":true},{"key":"neue_frist","label":"Neue Zahlungsfrist","type":"text","required":true}]'::jsonb,
 '["betreff","anrede","sachverhalt","forderung","frist","folgen_hinweis","signatur"]'::jsonb,
 '{"require_review":true,"avoid_legal_threats":true,"flag_deadlines":true}'::jsonb,
 'Du erstellst eine professionelle, sachliche Mahnung. Keine Drohungen, keine juristischen Versprechen. Weise auf neue Frist hin.',
 'Rechnung: {{rechnungsnummer}} über {{betrag}}, ursprünglich fällig {{faelligkeit}}. Neue Frist: {{neue_frist}}. Absender: {{company_name}}'),
('doc-meeting-protokoll','Meeting-Protokoll','Strukturiertes Protokoll mit Entscheidungen und To-Dos.','meeting_protokoll','dokumentation','low',false,'free',
 '[{"key":"thema","label":"Meeting-Thema","type":"text","required":true},{"key":"teilnehmer","label":"Teilnehmer","type":"textarea","required":true},{"key":"notizen","label":"Rohnotizen","type":"textarea","required":true}]'::jsonb,
 '["kopf","teilnehmer","agenda","entscheidungen","todos","naechste_schritte"]'::jsonb,
 '{}'::jsonb,
 'Strukturiere Meeting-Notizen in ein professionelles Protokoll mit klaren Entscheidungen und To-Dos (Verantwortlich + Frist).',
 'Thema: {{thema}}\nTeilnehmer: {{teilnehmer}}\nNotizen: {{notizen}}'),
('doc-sop','Standard Operating Procedure (SOP)','Berufsbezogene SOP mit klaren Schritten.','sop','prozess','medium',true,'pro',
 '[{"key":"prozess","label":"Prozess-Titel","type":"text","required":true},{"key":"ziel","label":"Prozessziel","type":"text","required":true},{"key":"schritte","label":"Bekannte Schritte (Stichworte)","type":"textarea","required":true}]'::jsonb,
 '["zweck","geltungsbereich","verantwortliche","schritte","qualitaetsmerkmale","abweichungen","freigabe"]'::jsonb,
 '{"require_review":true,"version_required":true}'::jsonb,
 'Du erstellst eine professionelle SOP mit nummerierten Schritten, Verantwortlichkeiten, Qualitätsmerkmalen und Eskalationspfaden. Markiere normativ/juristisch zu prüfende Punkte.',
 'Prozess: {{prozess}}\nZiel: {{ziel}}\nSchritte: {{schritte}}\nUnternehmen: {{company_name}}'),
('doc-checkliste','Checkliste','Prüfbare Checkliste für wiederkehrende Aufgaben.','checkliste','prozess','low',false,'free',
 '[{"key":"thema","label":"Thema der Checkliste","type":"text","required":true},{"key":"kontext","label":"Kontext / Anwendungsfall","type":"textarea","required":true}]'::jsonb,
 '["kopf","zweck","pruefpunkte","abzeichnung"]'::jsonb,
 '{}'::jsonb,
 'Erstelle eine prägnante, abprüfbare Checkliste (5–15 Punkte) mit Häkchenfeldern und Verantwortlichkeit.',
 'Thema: {{thema}}\nKontext: {{kontext}}'),
('doc-arbeitsanweisung','Arbeitsanweisung','Klare Arbeitsanweisung für Mitarbeiter.','arbeitsanweisung','prozess','medium',true,'pro',
 '[{"key":"taetigkeit","label":"Tätigkeit","type":"text","required":true},{"key":"sicherheit","label":"Sicherheitshinweise","type":"textarea","required":false}]'::jsonb,
 '["zweck","geltungsbereich","vorgaben","schritte","sicherheit","freigabe"]'::jsonb,
 '{"require_review":true,"check_safety":true}'::jsonb,
 'Erstelle eine klare Arbeitsanweisung mit Sicherheits- und Qualitätshinweisen. Markiere Lücken explizit.',
 'Tätigkeit: {{taetigkeit}}\nSicherheit: {{sicherheit}}\nUnternehmen: {{company_name}}'),
('doc-angebot','Angebotsschreiben','Strukturiertes Angebot mit Leistung, Preis und Konditionen.','angebot','kommunikation','medium',true,'pro',
 '[{"key":"empfaenger","label":"Empfänger","type":"text","required":true},{"key":"leistung","label":"Leistungsbeschreibung","type":"textarea","required":true},{"key":"preis","label":"Preis / Konditionen","type":"textarea","required":true},{"key":"gueltigkeit","label":"Gültigkeit","type":"text","required":true}]'::jsonb,
 '["briefkopf","betreff","anrede","leistung","preis","konditionen","gueltigkeit","signatur"]'::jsonb,
 '{"require_review":true,"flag_pricing":true,"avoid_binding_promises":true}'::jsonb,
 'Du erstellst ein professionelles, nicht-verbindliches Angebot. Markiere preisbindende Aussagen als zu prüfen.',
 'Empfänger: {{empfaenger}}\nLeistung: {{leistung}}\nPreis: {{preis}}\nGültigkeit: {{gueltigkeit}}\nAbsender: {{company_name}}'),
('doc-risikoanalyse','Risikoanalyse','Strukturierte Risikoanalyse mit Bewertung und Maßnahmen.','risikoanalyse','analyse','high',true,'business',
 '[{"key":"vorhaben","label":"Vorhaben / Prozess","type":"text","required":true},{"key":"bekannte_risiken","label":"Bekannte Risiken","type":"textarea","required":true}]'::jsonb,
 '["kontext","risiken","bewertung","massnahmen","verantwortlich","reviewbedarf"]'::jsonb,
 '{"require_review":true,"high_risk_warning":true}'::jsonb,
 'Erstelle eine professionelle Risikoanalyse: Risiken, Eintrittswahrscheinlichkeit (niedrig/mittel/hoch), Auswirkung, Maßnahmen, Verantwortliche. Markiere sicherheits-/juristisch relevante Punkte reviewpflichtig.',
 'Vorhaben: {{vorhaben}}\nBekannte Risiken: {{bekannte_risiken}}\nUnternehmen: {{company_name}}'),
('doc-datenschutz-hinweis','Datenschutz-Hinweis (Entwurf)','Entwurf eines Datenschutz-Hinweises für eine konkrete Verarbeitung.','datenschutz_hinweis','compliance','high',true,'business',
 '[{"key":"verarbeitung","label":"Verarbeitungstätigkeit","type":"textarea","required":true},{"key":"zweck","label":"Zweck","type":"text","required":true},{"key":"empfaenger","label":"Datenempfänger","type":"textarea","required":false}]'::jsonb,
 '["zweck","rechtsgrundlage_entwurf","datenkategorien","empfaenger","speicherdauer_entwurf","betroffenenrechte","reviewbedarf"]'::jsonb,
 '{"require_review":true,"legal_review_mandatory":true,"never_promise_legal_compliance":true}'::jsonb,
 'Du erstellst einen ENTWURF eines Datenschutz-Hinweises. WICHTIG: Markiere ausdrücklich, dass dieser Entwurf juristisch geprüft werden muss. Niemals als rechtssicher bezeichnen.',
 'Verarbeitung: {{verarbeitung}}\nZweck: {{zweck}}\nEmpfänger: {{empfaenger}}\nUnternehmen: {{company_name}}')
ON CONFLICT (slug) DO NOTHING;
