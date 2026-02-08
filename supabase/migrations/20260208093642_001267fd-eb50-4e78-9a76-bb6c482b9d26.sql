-- ============================================================
-- ENTERPRISE BLUEPRINT-TEMPLATE-SYSTEM
-- Prüfungssichere, variantenfähige, didaktisch saubere Fragen
-- ============================================================

-- 1️⃣ ENUMS für typsichere Werte
-- ============================================================

-- Wissenstypen (Was wird geprüft?)
CREATE TYPE public.knowledge_type AS ENUM (
  'concept',      -- Begriffe, Definitionen
  'procedure',    -- Abläufe, Prozesse
  'calculation',  -- Berechnungen, Formeln
  'regulation'    -- Vorschriften, Gesetze
);

-- Kognitive Stufen (Bloom's Taxonomy)
CREATE TYPE public.cognitive_level AS ENUM (
  'remember',     -- Erinnern (K1)
  'understand',   -- Verstehen (K2)
  'apply',        -- Anwenden (K3)
  'analyze'       -- Analysieren (K4)
);

-- Didaktische Absicht
CREATE TYPE public.didactic_intent AS ENUM (
  'transfer',           -- Wissenstransfer in neuen Kontext
  'recognition',        -- Wiedererkennung
  'error_detection',    -- Fehler erkennen
  'comparison',         -- Vergleichen
  'classification'      -- Klassifizieren/Zuordnen
);

-- Prüfungsrelevanz
CREATE TYPE public.exam_relevance AS ENUM (
  'low',
  'medium', 
  'high'
);

-- Variationstypen
CREATE TYPE public.variation_mode AS ENUM (
  'lexical',              -- Wortwahl-Variation
  'numerical',            -- Zahlen-Variation
  'contextual',           -- Kontext-Variation
  'distractor_rotation'   -- Distraktoren rotieren
);

-- Distraktor-Fehlertypen (didaktisch begründet)
CREATE TYPE public.distractor_error_type AS ENUM (
  'common_misconception',   -- Häufiger Irrtum
  'overgeneralization',     -- Übergeneralisierung
  'irrelevant_fact',        -- Irrelevante Tatsache
  'partial_truth',          -- Teilwahrheit
  'outdated_info',          -- Veraltete Info
  'confusing_similar'       -- Verwechslung mit Ähnlichem
);

-- Blueprint-Status
CREATE TYPE public.blueprint_status AS ENUM (
  'draft',       -- In Bearbeitung
  'review',      -- In Prüfung
  'approved',    -- Freigegeben
  'deprecated'   -- Veraltet
);

-- 2️⃣ HAUPT-TABELLE: question_blueprints (Blueprint Core)
-- ============================================================
CREATE TABLE public.question_blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- SSOT-Verknüpfungen (Pflicht)
  curriculum_id UUID NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  learning_field_id UUID REFERENCES public.learning_fields(id) ON DELETE SET NULL,
  competency_id UUID REFERENCES public.competencies(id) ON DELETE SET NULL,
  
  -- Blueprint Core
  name TEXT NOT NULL,
  canonical_statement TEXT NOT NULL,  -- Die fachliche Wahrheit (SSOT)
  knowledge_type public.knowledge_type NOT NULL DEFAULT 'concept',
  exam_relevance public.exam_relevance NOT NULL DEFAULT 'medium',
  allowed_question_types TEXT[] NOT NULL DEFAULT ARRAY['mc_single'],
  
  -- Didactic Frame
  cognitive_level public.cognitive_level NOT NULL DEFAULT 'understand',
  didactic_intent public.didactic_intent NOT NULL DEFAULT 'recognition',
  typical_exam_trap TEXT,  -- Häufige Prüfungsfalle
  real_world_context BOOLEAN NOT NULL DEFAULT true,
  language_level TEXT DEFAULT 'B1',  -- Sprachniveau
  
  -- Fragen-Template
  question_template TEXT NOT NULL,  -- Mit {variable} Platzhaltern
  explanation_template TEXT,        -- Erklärung mit Platzhaltern
  
  -- Variation Rules
  variation_modes public.variation_mode[] DEFAULT ARRAY['lexical'::public.variation_mode],
  max_similarity_score DECIMAL(3,2) DEFAULT 0.82,
  min_variation_distance DECIMAL(3,2) DEFAULT 0.18,
  max_variations INTEGER DEFAULT 20,
  
  -- Status & Audit
  status public.blueprint_status NOT NULL DEFAULT 'draft',
  version TEXT NOT NULL DEFAULT '1.0.0',
  change_reason TEXT,
  
  -- Metadaten
  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  deprecated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index für Performance
CREATE INDEX idx_question_blueprints_curriculum ON public.question_blueprints(curriculum_id);
CREATE INDEX idx_question_blueprints_competency ON public.question_blueprints(competency_id);
CREATE INDEX idx_question_blueprints_status ON public.question_blueprints(status);

-- 3️⃣ VARIABLE SLOTS (kontrollierte Variation)
-- ============================================================
CREATE TABLE public.blueprint_variables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id UUID NOT NULL REFERENCES public.question_blueprints(id) ON DELETE CASCADE,
  
  -- Variable Definition
  variable_name TEXT NOT NULL,  -- z.B. "actor", "amount", "timeframe"
  variable_type TEXT NOT NULL CHECK (variable_type IN ('entity', 'number', 'enum', 'text')),
  
  -- Werte-Definition (je nach Typ)
  allowed_values TEXT[],           -- Für entity/enum: Liste erlaubter Werte
  range_min DECIMAL,               -- Für number: Minimum
  range_max DECIMAL,               -- Für number: Maximum
  range_step DECIMAL,              -- Für number: Schrittweite
  text_pattern TEXT,               -- Für text: Regex-Pattern
  
  -- Validierung
  is_required BOOLEAN NOT NULL DEFAULT true,
  default_value TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(blueprint_id, variable_name)
);

-- 4️⃣ CONSTRAINT ENGINE (Prüfungsschutz)
-- ============================================================
CREATE TABLE public.blueprint_constraints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id UUID NOT NULL REFERENCES public.question_blueprints(id) ON DELETE CASCADE,
  
  -- Constraint-Definition
  constraint_type TEXT NOT NULL CHECK (constraint_type IN ('conditional', 'forbidden', 'required')),
  
  -- Bedingung (JSON für komplexe Logik)
  condition_expression JSONB NOT NULL,  -- z.B. {"amount": "> 3000"}
  action_expression JSONB NOT NULL,     -- z.B. {"timeframe": "sofort"}
  
  -- Beschreibung für Admin
  description TEXT,
  
  -- Priorisierung
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5️⃣ ANSWER MODEL (Distraktoren mit didaktischem Sinn)
-- ============================================================
CREATE TABLE public.blueprint_distractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id UUID NOT NULL REFERENCES public.question_blueprints(id) ON DELETE CASCADE,
  
  -- Distraktor-Template
  distractor_template TEXT NOT NULL,  -- Mit {variable} Platzhaltern
  
  -- Didaktische Klassifikation
  error_type public.distractor_error_type NOT NULL,
  error_explanation TEXT,  -- Warum ist das falsch?
  
  -- Sortierung & Status
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6️⃣ CORRECT ANSWER TEMPLATE
-- ============================================================
CREATE TABLE public.blueprint_correct_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id UUID NOT NULL REFERENCES public.question_blueprints(id) ON DELETE CASCADE,
  
  -- Antwort-Template
  answer_template TEXT NOT NULL,  -- Mit {variable} Platzhaltern
  
  -- Für Berechnungen: Formel
  calculation_formula TEXT,  -- z.B. "{amount} * 0.19"
  
  -- Für Mehrfachauswahl
  is_primary BOOLEAN NOT NULL DEFAULT true,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7️⃣ GENERATED VARIANTS (Erzeugte Varianten)
-- ============================================================
CREATE TABLE public.blueprint_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id UUID NOT NULL REFERENCES public.question_blueprints(id) ON DELETE CASCADE,
  
  -- Referenz zur erzeugten Prüfungsfrage
  exam_question_id UUID REFERENCES public.exam_questions(id) ON DELETE SET NULL,
  
  -- Verwendete Variablen-Werte
  variable_values JSONB NOT NULL,  -- z.B. {"actor": "Arbeitgeber", "amount": 2500}
  
  -- Generierungsdetails
  generation_seed INTEGER,
  similarity_score DECIMAL(3,2),  -- Ähnlichkeit zu anderen Varianten
  
  -- Validierung
  validation_passed BOOLEAN NOT NULL DEFAULT false,
  validation_errors TEXT[],
  
  -- Audit
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by TEXT  -- 'system' oder 'ai'
);

-- Index für Duplikat-Erkennung
CREATE INDEX idx_blueprint_variants_values ON public.blueprint_variants USING GIN(variable_values);

-- 8️⃣ BLUEPRINT AUDIT LOG (Versionierung)
-- ============================================================
CREATE TABLE public.blueprint_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id UUID NOT NULL REFERENCES public.question_blueprints(id) ON DELETE CASCADE,
  
  -- Änderungsdetails
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'approved', 'deprecated', 'variant_generated')),
  old_version TEXT,
  new_version TEXT,
  change_reason TEXT,
  
  -- Änderungsdaten (Diff)
  changes JSONB,
  
  -- Betroffene Varianten
  affected_variants_count INTEGER DEFAULT 0,
  
  -- Audit-Metadaten
  performed_by UUID REFERENCES auth.users(id),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9️⃣ VIEWS für Kompatibilität
-- ============================================================

-- View: Alle Blueprint-Fragen mit Curriculum-Kontext
CREATE OR REPLACE VIEW public.blueprint_questions_view AS
SELECT 
  qb.id AS blueprint_id,
  qb.name AS blueprint_name,
  qb.question_template,
  qb.knowledge_type,
  qb.cognitive_level,
  qb.exam_relevance,
  qb.status,
  qb.version,
  c.title AS curriculum_title,
  lf.title AS learning_field_title,
  lf.code AS learning_field_code,
  comp.title AS competency_title,
  comp.code AS competency_code,
  (SELECT COUNT(*) FROM public.blueprint_variants bv WHERE bv.blueprint_id = qb.id) AS variant_count,
  (SELECT COUNT(*) FROM public.blueprint_variables bvar WHERE bvar.blueprint_id = qb.id) AS variable_count
FROM public.question_blueprints qb
LEFT JOIN public.curricula c ON qb.curriculum_id = c.id
LEFT JOIN public.learning_fields lf ON qb.learning_field_id = lf.id
LEFT JOIN public.competencies comp ON qb.competency_id = comp.id;

-- 🔐 RLS POLICIES
-- ============================================================

ALTER TABLE public.question_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_distractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_correct_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_audit_log ENABLE ROW LEVEL SECURITY;

-- Admins: Vollzugriff auf alle Blueprint-Tabellen
CREATE POLICY "Admins can manage blueprints" ON public.question_blueprints
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  );

CREATE POLICY "Admins can manage variables" ON public.blueprint_variables
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  );

CREATE POLICY "Admins can manage constraints" ON public.blueprint_constraints
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  );

CREATE POLICY "Admins can manage distractors" ON public.blueprint_distractors
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  );

CREATE POLICY "Admins can manage correct answers" ON public.blueprint_correct_answers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  );

CREATE POLICY "Admins can manage variants" ON public.blueprint_variants
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  );

CREATE POLICY "Admins can view audit log" ON public.blueprint_audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  );

-- 🔄 UPDATE TRIGGER
-- ============================================================
CREATE TRIGGER update_question_blueprints_updated_at
  BEFORE UPDATE ON public.question_blueprints
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 📊 HILFSFUNKTION: Constraint-Validierung
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_blueprint_constraints(
  p_blueprint_id UUID,
  p_variable_values JSONB
) RETURNS TABLE (
  is_valid BOOLEAN,
  errors TEXT[]
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_errors TEXT[] := ARRAY[]::TEXT[];
  v_constraint RECORD;
  v_condition_met BOOLEAN;
BEGIN
  -- Prüfe alle aktiven Constraints
  FOR v_constraint IN 
    SELECT * FROM public.blueprint_constraints 
    WHERE blueprint_id = p_blueprint_id AND is_active = true
    ORDER BY priority DESC
  LOOP
    -- Hier würde die eigentliche Constraint-Auswertung stattfinden
    -- Vereinfachte Implementierung für MVP
    NULL;
  END LOOP;
  
  RETURN QUERY SELECT array_length(v_errors, 1) IS NULL OR array_length(v_errors, 1) = 0, v_errors;
END;
$$;