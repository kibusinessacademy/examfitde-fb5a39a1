
-- ============================================================
-- LLM Council: Validation Mode Tables
-- ============================================================

-- 1. AI Generations – tracks every LLM output
CREATE TABLE public.ai_generations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL, -- 'lesson', 'question', 'tutor_response', 'blog_article', 'oral_exam'
  entity_id UUID, -- FK to the actual entity (lesson, question, etc.)
  generator_model TEXT NOT NULL, -- 'openai/gpt-5.2', 'deepseek-chat', etc.
  prompt_hash TEXT,
  input_context JSONB, -- SSOT context sent to generator
  output_content JSONB NOT NULL, -- raw generated content
  output_tokens INTEGER,
  input_tokens INTEGER,
  cost_eur NUMERIC(10,6) DEFAULT 0,
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'draft', -- draft, generated, validated, approved, published, rejected
  validation_decision TEXT, -- approve, revise, reject
  validation_score INTEGER, -- 0-100
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- 2. AI Validations – every validation run by Opus
CREATE TABLE public.ai_validations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  generation_id UUID NOT NULL REFERENCES public.ai_generations(id) ON DELETE CASCADE,
  validator_model TEXT NOT NULL DEFAULT 'claude-opus-4-20250514',
  validation_mode TEXT NOT NULL DEFAULT 'automatic', -- automatic, manual
  overall_score INTEGER NOT NULL, -- 0-100
  decision TEXT NOT NULL, -- approve, revise, reject
  dimension_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- e.g. {"fachlichkeit": 92, "didaktik": 90, "pruefungsrelevanz": 88, "klarheit": 94}
  critical_issues JSONB DEFAULT '[]'::jsonb,
  suggested_fixes JSONB DEFAULT '[]'::jsonb,
  corrected_content JSONB, -- if Opus provides corrected version
  improvements TEXT[],
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_eur NUMERIC(10,6) DEFAULT 0,
  latency_ms INTEGER,
  validated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_by UUID, -- null = automatic, user_id = manual
  metadata JSONB DEFAULT '{}'::jsonb
);

-- 3. AI Validation Rules – configurable rules per entity type
CREATE TABLE public.ai_validation_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL, -- 'lesson', 'question', 'tutor_response', 'blog_article'
  rule_name TEXT NOT NULL,
  rule_description TEXT,
  dimension TEXT NOT NULL, -- 'fachlichkeit', 'didaktik', 'pruefungsrelevanz', 'klarheit', 'vollstaendigkeit'
  weight NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  min_score INTEGER DEFAULT 0, -- minimum acceptable score
  is_critical BOOLEAN DEFAULT false, -- if true, failing this = auto-reject
  prompt_template TEXT, -- specific validation prompt for this rule
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_type, rule_name)
);

-- 4. AI Quality Gates – tracks approval workflow
CREATE TABLE public.ai_quality_gates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  generation_id UUID NOT NULL REFERENCES public.ai_generations(id) ON DELETE CASCADE,
  gate_type TEXT NOT NULL, -- 'auto_validation', 'manual_review', 'admin_approval'
  gate_status TEXT NOT NULL DEFAULT 'pending', -- pending, passed, failed, skipped
  required_score INTEGER DEFAULT 80,
  actual_score INTEGER,
  decided_by UUID, -- null = auto, user_id = manual
  decided_at TIMESTAMPTZ,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Enable RLS
ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_validation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_quality_gates ENABLE ROW LEVEL SECURITY;

-- RLS: Admins can do everything, users can read their own generations
CREATE POLICY "Admins full access on ai_generations"
  ON public.ai_generations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users read own tutor generations"
  ON public.ai_generations FOR SELECT
  USING (created_by = auth.uid() AND entity_type = 'tutor_response');

CREATE POLICY "Admins full access on ai_validations"
  ON public.ai_validations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins full access on ai_validation_rules"
  ON public.ai_validation_rules FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins full access on ai_quality_gates"
  ON public.ai_quality_gates FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Service role insert for edge functions (no auth context)
CREATE POLICY "Service insert ai_generations"
  ON public.ai_generations FOR INSERT WITH CHECK (true);
CREATE POLICY "Service insert ai_validations"
  ON public.ai_validations FOR INSERT WITH CHECK (true);
CREATE POLICY "Service insert ai_quality_gates"
  ON public.ai_quality_gates FOR INSERT WITH CHECK (true);

-- Indexes
CREATE INDEX idx_ai_generations_entity ON public.ai_generations(entity_type, entity_id);
CREATE INDEX idx_ai_generations_status ON public.ai_generations(status);
CREATE INDEX idx_ai_validations_generation ON public.ai_validations(generation_id);
CREATE INDEX idx_ai_validations_decision ON public.ai_validations(decision);
CREATE INDEX idx_ai_quality_gates_generation ON public.ai_quality_gates(generation_id);
CREATE INDEX idx_ai_quality_gates_status ON public.ai_quality_gates(gate_status);

-- Seed default validation rules
INSERT INTO public.ai_validation_rules (entity_type, rule_name, rule_description, dimension, weight, min_score, is_critical) VALUES
  ('lesson', 'fachliche_korrektheit', 'Alle Fakten müssen korrekt sein, keine Halluzinationen', 'fachlichkeit', 30, 70, true),
  ('lesson', 'didaktische_qualitaet', '5-Schritte-Didaktik, Anwenden=Entscheidung, progressive Komplexität', 'didaktik', 25, 60, false),
  ('lesson', 'pruefungsrelevanz', 'Explizite IHK-Prüfungsbezüge, typische Fragestellungen', 'pruefungsrelevanz', 20, 50, false),
  ('lesson', 'sprachliche_klarheit', 'Verständlich für Azubis, klare Fachbegriffe', 'klarheit', 15, 60, false),
  ('lesson', 'vollstaendigkeit', 'Alle nötigen Aspekte abgedeckt, Lernziele definiert', 'vollstaendigkeit', 10, 50, false),
  ('question', 'eindeutigkeit', 'Genau eine richtige Antwort, keine Mehrdeutigkeit', 'fachlichkeit', 35, 80, true),
  ('question', 'distraktoren_qualitaet', 'Plausible aber eindeutig falsche Distraktoren', 'didaktik', 25, 70, true),
  ('question', 'ihk_konformitaet', 'Entspricht IHK-Prüfungsstil und -logik', 'pruefungsrelevanz', 25, 60, false),
  ('question', 'taxonomie_passung', 'Passt zur angegebenen Bloom-Taxonomiestufe', 'didaktik', 15, 50, false),
  ('tutor_response', 'fachliche_korrektheit', 'Antwort ist fachlich korrekt', 'fachlichkeit', 50, 80, true),
  ('tutor_response', 'verstaendlichkeit', 'Für Azubis verständlich und hilfreich', 'klarheit', 30, 60, false),
  ('tutor_response', 'keine_halluzination', 'Keine erfundenen Fakten oder Gesetze', 'fachlichkeit', 20, 90, true),
  ('blog_article', 'seo_qualitaet', 'Keywords, Struktur, Meta-Beschreibung vorhanden', 'vollstaendigkeit', 40, 50, false),
  ('blog_article', 'fachliche_korrektheit', 'Aussagen korrekt und belegbar', 'fachlichkeit', 40, 60, true),
  ('blog_article', 'sprachqualitaet', 'Professionelle, ansprechende Sprache', 'klarheit', 20, 50, false);

-- Trigger for updated_at on validation_rules
CREATE TRIGGER update_ai_validation_rules_updated_at
  BEFORE UPDATE ON public.ai_validation_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
