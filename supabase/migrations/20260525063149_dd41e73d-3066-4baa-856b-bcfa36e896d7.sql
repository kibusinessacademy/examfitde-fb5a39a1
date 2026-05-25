
-- ============================================================
-- BERUFS-KI FOUNDATION (Phase 1)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.berufs_ki_workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('kommunikation','analyse','dokumentation','organisation','fach','lernhilfe')),
  subcategory text,

  -- SSOT bridge (all nullable — workflows can be universal or beruf-specific)
  curriculum_id uuid REFERENCES public.course_packages(id) ON DELETE SET NULL,
  learning_field_id uuid,
  competency_ids uuid[] NOT NULL DEFAULT '{}',
  blueprint_refs jsonb NOT NULL DEFAULT '[]'::jsonb,

  target_roles text[] NOT NULL DEFAULT ARRAY['fachkraft']::text[],
  tier_required text NOT NULL DEFAULT 'free' CHECK (tier_required IN ('free','pro','business')),

  -- Workflow contract
  input_schema  jsonb NOT NULL DEFAULT '{"fields":[]}'::jsonb,
  output_schema jsonb NOT NULL DEFAULT '{"sections":["executive_summary","analyse","handlungsempfehlungen","risiken","naechste_schritte"]}'::jsonb,

  system_prompt text NOT NULL,
  user_prompt_template text NOT NULL,
  model_recommendation text NOT NULL DEFAULT 'google/gemini-2.5-pro',

  compliance_level text NOT NULL DEFAULT 'standard' CHECK (compliance_level IN ('standard','sensitive','regulated')),
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high')),

  version int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_berufs_ki_wfd_active_category
  ON public.berufs_ki_workflow_definitions (is_active, category);
CREATE INDEX IF NOT EXISTS idx_berufs_ki_wfd_curriculum
  ON public.berufs_ki_workflow_definitions (curriculum_id) WHERE curriculum_id IS NOT NULL;

ALTER TABLE public.berufs_ki_workflow_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "berufs_ki_wfd_public_read_active"
  ON public.berufs_ki_workflow_definitions FOR SELECT
  USING (is_active = true);

CREATE POLICY "berufs_ki_wfd_admin_all"
  ON public.berufs_ki_workflow_definitions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_berufs_ki_wfd_updated_at
  BEFORE UPDATE ON public.berufs_ki_workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- Workflow runs (audit)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.berufs_ki_workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.berufs_ki_workflow_definitions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  beruf_slug text,

  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_text text,
  output_structured jsonb,

  model_used text,
  tokens_in int,
  tokens_out int,
  latency_ms int,

  tier_at_run text,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','blocked','rate_limited')),
  error_reason text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_berufs_ki_runs_user ON public.berufs_ki_workflow_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_berufs_ki_runs_workflow ON public.berufs_ki_workflow_runs (workflow_id, created_at DESC);

ALTER TABLE public.berufs_ki_workflow_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "berufs_ki_runs_owner_read"
  ON public.berufs_ki_workflow_runs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- INSERT only via service_role (Edge function). No client INSERT policy.

-- ------------------------------------------------------------
-- Seed: 6 universal workflows (one per category)
-- ------------------------------------------------------------
INSERT INTO public.berufs_ki_workflow_definitions
  (slug, title, description, category, subcategory, target_roles, tier_required,
   input_schema, system_prompt, user_prompt_template, risk_level)
VALUES
(
  'pro-kundenmail-antworten',
  'Professionelle Kundenmail beantworten',
  'Beantworte eine Kundenanfrage, Reklamation oder Beschwerde sicher, fachlich und mit klarer Eskalationslogik.',
  'kommunikation', 'kundenkommunikation',
  ARRAY['fachkraft','azubi']::text[], 'free',
  '{"fields":[
    {"key":"beruf","label":"Mein Beruf / Rolle","type":"text","required":true,"placeholder":"z.B. Industriekaufmann, Hausverwalter"},
    {"key":"kunde","label":"Kunde / Absender","type":"text","required":true},
    {"key":"anliegen","label":"Anliegen des Kunden (Original-Mail oder Stichpunkte)","type":"textarea","required":true},
    {"key":"ziel","label":"Was soll dein Ergebnis erreichen?","type":"text","required":true},
    {"key":"tonalitaet","label":"Tonalität","type":"select","options":["sachlich","verbindlich","empathisch","deeskalierend"],"required":true}
  ]}'::jsonb,
  'Du bist ein erfahrener, professioneller Kollege im genannten Beruf. Du antwortest deutsch, fachlich korrekt, DSGVO-sicher und ohne Halluzinationen. Vermeide Versprechen, die rechtliche Risiken erzeugen. Wenn Information fehlt, frage präzise nach. Liefere die Sektionen Executive Summary, Antwort-Mail (versandfertig), Eskalationsbewertung, Risiken, Folgeaktionen.',
  'Beruf/Rolle: {{beruf}}\nKunde: {{kunde}}\nAnliegen:\n{{anliegen}}\n\nZiel der Antwort: {{ziel}}\nTonalität: {{tonalitaet}}\n\nBitte erstelle eine versandfertige professionelle Antwort und ergänze die strukturierten Sektionen.',
  'medium'
),
(
  'kpi-analyse-erklaeren',
  'KPI- oder Datenanalyse erklären',
  'Erkläre Zahlen, KPIs oder Excel-Auswertungen verständlich und identifiziere Auffälligkeiten, Risiken und Empfehlungen.',
  'analyse', 'kpi',
  ARRAY['fachkraft','teamleiter']::text[], 'free',
  '{"fields":[
    {"key":"beruf","label":"Beruf / Funktion","type":"text","required":true},
    {"key":"kontext","label":"Geschäftskontext (Branche, Abteilung, Zeitraum)","type":"textarea","required":true},
    {"key":"daten","label":"Zahlen / KPIs / Auszug","type":"textarea","required":true},
    {"key":"frage","label":"Konkrete Frage an die Analyse","type":"text","required":true}
  ]}'::jsonb,
  'Du bist ein erfahrener Business-Analyst im genannten Beruf. Antworte deutsch, fachlich präzise und ohne Halluzinationen. Niemals Zahlen erfinden. Wenn Daten unvollständig sind, benenne die Lücke. Liefere Executive Summary, Analyse, Auffälligkeiten, Handlungsempfehlungen, Risiken, KPI-Vorschläge.',
  'Beruf: {{beruf}}\nKontext: {{kontext}}\n\nDaten:\n{{daten}}\n\nFrage: {{frage}}',
  'low'
),
(
  'meeting-protokoll-strukturieren',
  'Meeting-Protokoll strukturieren',
  'Aus rohen Notizen ein professionelles Protokoll mit Beschlüssen, To-Dos und Verantwortlichen erzeugen.',
  'dokumentation', 'protokoll',
  ARRAY['fachkraft','azubi','teamleiter']::text[], 'free',
  '{"fields":[
    {"key":"beruf","label":"Beruf / Rolle","type":"text","required":true},
    {"key":"meeting_titel","label":"Meeting-Titel","type":"text","required":true},
    {"key":"datum","label":"Datum","type":"text","required":true},
    {"key":"teilnehmer","label":"Teilnehmer","type":"text","required":true},
    {"key":"notizen","label":"Rohe Notizen / Mitschrift","type":"textarea","required":true}
  ]}'::jsonb,
  'Du bist ein erfahrener Profi im genannten Beruf. Erstelle ein versandfertiges, klares Meeting-Protokoll auf Deutsch. Niemals Inhalte erfinden. Liefere Sektionen: Executive Summary, Beschlüsse, Diskussion, Offene Punkte, To-Dos (Owner + Frist), Folge-Termine.',
  'Beruf: {{beruf}}\nMeeting: {{meeting_titel}}\nDatum: {{datum}}\nTeilnehmer: {{teilnehmer}}\n\nNotizen:\n{{notizen}}',
  'low'
),
(
  'tagesplan-priorisieren',
  'Arbeitstag priorisieren & planen',
  'Aus deiner To-Do-Liste einen sinnvoll priorisierten Tagesplan inkl. Risiken und Pufferzeiten erzeugen.',
  'organisation', 'tagesplanung',
  ARRAY['fachkraft','azubi']::text[], 'free',
  '{"fields":[
    {"key":"beruf","label":"Beruf / Rolle","type":"text","required":true},
    {"key":"verfuegbare_zeit","label":"Verfügbare Arbeitszeit heute","type":"text","required":true,"placeholder":"z.B. 8h"},
    {"key":"todos","label":"Alle Aufgaben (eine pro Zeile)","type":"textarea","required":true},
    {"key":"fixtermine","label":"Fixe Termine (mit Uhrzeit)","type":"textarea","required":false}
  ]}'::jsonb,
  'Du bist ein erfahrener Profi im genannten Beruf. Priorisiere nach Wirkung, Dringlichkeit, Abhängigkeiten und Fixterminen. Liefere Sektionen: Executive Summary, Priorisierte Tagesliste (Reihenfolge + geschätzte Dauer), Risiken/Engpässe, Pufferplan, Was lasse ich heute bewusst weg.',
  'Beruf: {{beruf}}\nZeit: {{verfuegbare_zeit}}\nFixtermine:\n{{fixtermine}}\n\nAufgaben:\n{{todos}}',
  'low'
),
(
  'fachgespraech-vorbereiten',
  'Fachgespräch / Prüfungssituation vorbereiten',
  'Vorbereitung auf ein Fachgespräch, Kundengespräch oder Prüfungsgespräch mit typischen Fragen und Antwortgerüsten.',
  'fach', 'gespraechsvorbereitung',
  ARRAY['azubi','fachkraft']::text[], 'free',
  '{"fields":[
    {"key":"beruf","label":"Beruf","type":"text","required":true},
    {"key":"thema","label":"Thema / Fachgebiet","type":"text","required":true},
    {"key":"situation","label":"Wer fragt, in welchem Setting?","type":"textarea","required":true},
    {"key":"meine_unsicherheit","label":"Wo bist du unsicher?","type":"textarea","required":false}
  ]}'::jsonb,
  'Du bist ein erfahrener Profi im genannten Beruf und Prüfer-Coach. Niemals halluzinieren. Liefere: Executive Summary, 8 typische Fragen mit kurzen Antwortgerüsten, häufige Stolperfallen, Fachsprache-Cheatsheet, Souveränitäts-Tipps.',
  'Beruf: {{beruf}}\nThema: {{thema}}\nSituation: {{situation}}\nUnsicherheit: {{meine_unsicherheit}}',
  'low'
),
(
  'thema-erklaeren-meinem-niveau',
  'Fachthema auf meinem Niveau erklären',
  'Lass dir ein berufliches Thema verständlich erklären — angepasst an Vorwissen, Beruf und Anwendung im Arbeitsalltag.',
  'lernhilfe', 'erklaerung',
  ARRAY['azubi','fachkraft']::text[], 'free',
  '{"fields":[
    {"key":"beruf","label":"Beruf","type":"text","required":true},
    {"key":"thema","label":"Was soll erklärt werden?","type":"text","required":true},
    {"key":"vorwissen","label":"Vorwissen (Stichworte)","type":"textarea","required":false},
    {"key":"anwendung","label":"Wo brauche ich das im Alltag?","type":"text","required":false}
  ]}'::jsonb,
  'Du bist ein erfahrener Profi und didaktischer Coach im genannten Beruf. Erkläre verständlich, fachlich korrekt, ohne Halluzinationen, mit Beispielen aus dem Berufsalltag. Liefere: Executive Summary, Schritt-für-Schritt-Erklärung, konkretes Beispiel aus dem Berufsalltag, typische Fehler, Selbst-Check (3 Fragen).',
  'Beruf: {{beruf}}\nThema: {{thema}}\nVorwissen: {{vorwissen}}\nAnwendung: {{anwendung}}',
  'low'
)
ON CONFLICT (slug) DO NOTHING;
