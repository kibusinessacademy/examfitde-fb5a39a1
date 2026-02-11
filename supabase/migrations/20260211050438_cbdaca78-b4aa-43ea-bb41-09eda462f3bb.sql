
-- ============================================================
-- SEO-Core: seo_documents, seo_templates, seo_generation_jobs
-- ============================================================

-- A) seo_documents – SSOT for every SEO text
CREATE TABLE public.seo_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doc_type text NOT NULL CHECK (doc_type IN ('landing','product','blog','faq','glossary','cluster')),
  slug text NOT NULL,
  title text NOT NULL,
  meta_title text,
  meta_description text,
  content_md text,
  excerpt text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','published','archived')),
  language text NOT NULL DEFAULT 'de',
  canonical_url text,
  og_image_path text,
  -- SSOT References
  beruf_id uuid REFERENCES public.berufe(id),
  curriculum_id uuid REFERENCES public.curricula(id),
  competency_id uuid REFERENCES public.competencies(id),
  product_key text,
  -- Uniqueness & QC
  content_hash text,
  similarity_group text,
  qc_score integer DEFAULT 0,
  qc_report jsonb DEFAULT '{}'::jsonb,
  internal_links jsonb DEFAULT '[]'::jsonb,
  -- Timestamps
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique slug per doc_type
CREATE UNIQUE INDEX idx_seo_documents_slug ON public.seo_documents(doc_type, slug);
CREATE INDEX idx_seo_documents_status ON public.seo_documents(status);
CREATE INDEX idx_seo_documents_beruf ON public.seo_documents(beruf_id) WHERE beruf_id IS NOT NULL;
CREATE INDEX idx_seo_documents_curriculum ON public.seo_documents(curriculum_id) WHERE curriculum_id IS NOT NULL;
CREATE INDEX idx_seo_documents_hash ON public.seo_documents(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX idx_seo_documents_published ON public.seo_documents(status, published_at DESC) WHERE status = 'published';

ALTER TABLE public.seo_documents ENABLE ROW LEVEL SECURITY;

-- Public read for published docs
CREATE POLICY "Published SEO docs are public" ON public.seo_documents
  FOR SELECT USING (status = 'published');

-- Service role can do everything (admin via edge functions)
CREATE POLICY "Service role full access seo_documents" ON public.seo_documents
  FOR ALL USING (true) WITH CHECK (true);

-- B) seo_templates – Blueprints for content structure & tone
CREATE TABLE public.seo_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_key text NOT NULL UNIQUE,
  doc_type text NOT NULL CHECK (doc_type IN ('landing','product','blog','faq','glossary','cluster')),
  display_name text NOT NULL,
  outline_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_system text,
  prompt_user text,
  style_rules_json jsonb DEFAULT '{}'::jsonb,
  qc_rules_json jsonb DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seo_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access seo_templates" ON public.seo_templates
  FOR ALL USING (true) WITH CHECK (true);

-- C) seo_generation_jobs – Job queue for SEO content generation
CREATE TABLE public.seo_generation_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_type text NOT NULL CHECK (job_type IN ('generate','refresh','rewrite','internal_linking','image_generate','qc_check','publish')),
  template_key text REFERENCES public.seo_templates(template_key),
  target_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','failed','done')),
  result_doc_id uuid REFERENCES public.seo_documents(id),
  cost_eur numeric(8,4) DEFAULT 0,
  tokens_used integer DEFAULT 0,
  model text,
  logs jsonb DEFAULT '[]'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX idx_seo_gen_jobs_status ON public.seo_generation_jobs(status);

ALTER TABLE public.seo_generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access seo_generation_jobs" ON public.seo_generation_jobs
  FOR ALL USING (true) WITH CHECK (true);

-- D) Updated_at trigger for seo_documents
CREATE TRIGGER update_seo_documents_updated_at
  BEFORE UPDATE ON public.seo_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_seo_templates_updated_at
  BEFORE UPDATE ON public.seo_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- E) Seed default templates
INSERT INTO public.seo_templates (template_key, doc_type, display_name, prompt_system, prompt_user, outline_json, style_rules_json, qc_rules_json) VALUES
(
  'landing_azubis_v1', 'landing', 'Landingpage Azubis',
  'Du schreibst SEO-optimierte Landingpages für Auszubildende. Dein Ton ist freundlich, direkt und motivierend – wie ein erfahrener Mentor. Vermeide: Marketing-Floskeln, leere Versprechen, "In diesem Artikel", "Zusammenfassend". Nutze kurze und lange Sätze abwechselnd. Verwende aktive Sprache.',
  'Erstelle eine Landingpage für den Ausbildungsberuf "{{beruf}}" mit Fokus auf Prüfungsvorbereitung für Azubis. Integriere: Berufsprofil ({{dauer}} Monate, DQR {{dqr}}), typische Prüfungsthemen, Lernpfad-Empfehlung, CTA zu ExamFit. Markdown-Format, H1+H2+H3 Struktur.',
  '[{"type":"h1","label":"Hauptüberschrift mit Beruf + Prüfung"},{"type":"h2","label":"Was erwartet dich in der Prüfung?"},{"type":"h2","label":"Dein Lernpfad"},{"type":"h2","label":"Warum ExamFit?"},{"type":"cta","label":"Jetzt starten"}]',
  '{"banned_phrases":["In diesem Artikel","Zusammenfassend","garantiert bestehen","100% Erfolg"],"min_sentence_variation":true,"active_voice":true,"max_marketing_density":0.05}',
  '{"min_ssot_refs":1,"min_word_count":500,"max_word_count":2000,"min_h2_count":3,"max_h2_count":8,"required_cta":true,"max_cta_count":2}'
),
(
  'landing_betriebe_v1', 'landing', 'Landingpage Betriebe',
  'Du schreibst für Ausbildungsbetriebe und HR-Verantwortliche. Dein Ton ist professionell, lösungsorientiert und konkret. Vermeide: Buzzwords, leere Superlative. Fokussiere auf ROI, Durchfallquoten-Senkung, AZAV-Förderfähigkeit.',
  'Erstelle eine Landingpage für Ausbildungsbetriebe zum Beruf "{{beruf}}". Zeige: Durchfallquoten-Problem, ExamFit als Lösung, Integration in betriebliche Ausbildung, Fördermöglichkeiten (AZAV). Markdown.',
  '[{"type":"h1","label":"Betriebe-Headline"},{"type":"h2","label":"Das Durchfallquoten-Problem"},{"type":"h2","label":"ExamFit für Betriebe"},{"type":"h2","label":"Förderung & AZAV"},{"type":"cta","label":"Demo anfragen"}]',
  '{"banned_phrases":["In diesem Artikel","Zusammenfassend"],"professional_tone":true,"data_driven":true}',
  '{"min_ssot_refs":1,"min_word_count":400,"max_word_count":1500,"min_h2_count":3,"required_cta":true}'
),
(
  'blog_pruefungstipps_v1', 'blog', 'Blog: Prüfungstipps',
  'Du schreibst hilfreiche Blog-Artikel für Auszubildende. Dein Ton: empathisch, praktisch, erfahren – wie ein Azubi-Coach. KEINE Floskeln. KEINE leeren Versprechen. Jeder Absatz muss einen konkreten Mehrwert bieten. Variiere Satzlängen bewusst.',
  'Schreibe einen Blog-Artikel zum Thema "{{thema}}" für Azubis im Beruf "{{beruf}}". Integriere konkrete Beispiele aus dem Berufsalltag. Markdown mit H1, H2, H3. Mindestens 800 Wörter.',
  '[{"type":"h1","label":"Titel"},{"type":"intro","label":"Hook + Problemstellung"},{"type":"h2","label":"Hauptteil 1"},{"type":"h2","label":"Hauptteil 2"},{"type":"h2","label":"Praxis-Tipps"},{"type":"h2","label":"Fazit + CTA"}]',
  '{"banned_phrases":["In diesem Artikel","Zusammenfassend","wie wir alle wissen","es ist kein Geheimnis"],"min_sentence_variation":true,"storytelling":true}',
  '{"min_ssot_refs":1,"min_word_count":800,"max_word_count":2500,"min_h2_count":3,"required_cta":true,"max_cta_count":2}'
),
(
  'faq_beruf_v1', 'faq', 'FAQ pro Beruf',
  'Du erstellst FAQ-Seiten für Ausbildungsberufe. Jede Antwort ist präzise, hilfreich und SEO-optimiert. Verwende Schema.org FAQ-Markup-kompatible Struktur.',
  'Erstelle 8-12 häufig gestellte Fragen zur Ausbildung und Prüfung im Beruf "{{beruf}}". Beziehe dich auf: Prüfungsstruktur, Lernfelder, typische Stolpersteine, Vorbereitung. Jede Antwort 50-150 Wörter.',
  '[{"type":"faq_list","label":"FAQ Items"}]',
  '{"concise":true,"factual":true}',
  '{"min_ssot_refs":1,"min_faq_count":8,"max_faq_count":15,"max_answer_words":150}'
),
(
  'glossary_v1', 'glossary', 'Glossar-Eintrag',
  'Du schreibst Glossareinträge für Fachbegriffe aus der Berufsausbildung. Kurz, präzise, verständlich. Immer mit Bezug zum Prüfungskontext.',
  'Erstelle einen Glossareintrag für den Begriff "{{begriff}}" im Kontext des Berufs "{{beruf}}". Definition, Prüfungsrelevanz, Beispiel. Max 200 Wörter.',
  '[{"type":"definition","label":"Definition"},{"type":"context","label":"Prüfungskontext"},{"type":"example","label":"Beispiel"}]',
  '{"concise":true,"definition_first":true}',
  '{"min_word_count":80,"max_word_count":300}'
);
