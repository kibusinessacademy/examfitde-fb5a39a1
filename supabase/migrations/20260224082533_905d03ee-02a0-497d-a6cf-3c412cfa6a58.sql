
-- ============================================================
-- PREMIUM UPGRADE PLAN – Phase 1: Schema-Erweiterungen
-- ============================================================

-- 1.1 Competencies: Bloom-Härtung + Fehler-Ökosystem
ALTER TABLE competencies ADD COLUMN IF NOT EXISTS bloom_level TEXT
  CHECK (bloom_level IN ('remember','understand','apply','analyze','evaluate'));
ALTER TABLE competencies ADD COLUMN IF NOT EXISTS action_verb TEXT;
ALTER TABLE competencies ADD COLUMN IF NOT EXISTS context_conditions TEXT;
ALTER TABLE competencies ADD COLUMN IF NOT EXISTS typical_misconceptions JSONB DEFAULT '[]';
ALTER TABLE competencies ADD COLUMN IF NOT EXISTS exam_relevance_tier TEXT
  CHECK (exam_relevance_tier IN ('core','important','supplementary'));
ALTER TABLE competencies ADD COLUMN IF NOT EXISTS transfer_markers JSONB DEFAULT '[]';

-- 1.2 Learning Fields: Zeitmodell + Mastery + Bloom-Target
ALTER TABLE learning_fields ADD COLUMN IF NOT EXISTS exam_time_minutes INTEGER;
ALTER TABLE learning_fields ADD COLUMN IF NOT EXISTS min_mastery_pct INTEGER DEFAULT 60;
ALTER TABLE learning_fields ADD COLUMN IF NOT EXISTS question_target INTEGER;
ALTER TABLE learning_fields ADD COLUMN IF NOT EXISTS bloom_distribution_target JSONB
  DEFAULT '{"remember":0.15,"understand":0.25,"apply":0.30,"analyze":0.20,"evaluate":0.10}';

-- 1.3 Curricula: Prüfungsstruktur-Modell
ALTER TABLE curricula ADD COLUMN IF NOT EXISTS exam_structure JSONB DEFAULT '{}';
ALTER TABLE curricula ADD COLUMN IF NOT EXISTS passing_rules JSONB DEFAULT '{}';

-- 1.4 Exam Questions: Prüfungsmodell-Mapping + Psychometrie
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS exam_part TEXT;
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS scenario_type TEXT CHECK (scenario_type IN (
  'isolated_knowledge','applied_case','multi_step_case','prioritization',
  'error_detection','documentation_analysis','legal_evaluation','communication_scenario'));
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS bloom_level_validated TEXT;
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS time_estimate_seconds INTEGER;
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS typical_errors JSONB DEFAULT '[]';
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS discrimination_tier TEXT
  CHECK (discrimination_tier IN ('elite','acceptable','weak','reject'));

-- 1.5 Quality Constraints (Neue Tabelle)
CREATE TABLE IF NOT EXISTS blueprint_quality_constraints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id UUID REFERENCES curricula(id) ON DELETE CASCADE,
  constraint_key TEXT NOT NULL,
  constraint_config JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(curriculum_id, constraint_key)
);

ALTER TABLE blueprint_quality_constraints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin access to quality constraints"
  ON blueprint_quality_constraints FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'::app_role)
  );

-- 1.6 Retroaktives Mapping: exam_part aus Learning Fields
UPDATE exam_questions eq 
SET exam_part = lf.exam_part
FROM learning_fields lf 
WHERE eq.learning_field_id = lf.id AND eq.exam_part IS NULL AND lf.exam_part IS NOT NULL;

-- 1.7 Retroaktives Mapping: scenario_type aus Blueprint
UPDATE exam_questions eq 
SET scenario_type = bp.exam_context_type::text
FROM question_blueprints bp 
WHERE eq.blueprint_id = bp.id AND eq.scenario_type IS NULL AND bp.exam_context_type IS NOT NULL;

-- 1.8 Bloom-Level Migration in competencies
UPDATE competencies 
SET bloom_level = CASE 
  WHEN lower(taxonomy_level) IN ('remember', 'erinnern', 'wissen', 'k1') THEN 'remember'
  WHEN lower(taxonomy_level) IN ('understand', 'verstehen', 'k2') THEN 'understand'
  WHEN lower(taxonomy_level) IN ('apply', 'anwenden', 'k3') THEN 'apply'
  WHEN lower(taxonomy_level) IN ('analyze', 'analysieren', 'k4') THEN 'analyze'
  WHEN lower(taxonomy_level) IN ('evaluate', 'bewerten', 'beurteilen', 'k5') THEN 'evaluate'
  ELSE NULL
END
WHERE bloom_level IS NULL AND taxonomy_level IS NOT NULL;

-- 1.9 Default Quality Constraints für alle Curricula
INSERT INTO blueprint_quality_constraints (curriculum_id, constraint_key, constraint_config)
SELECT c.id, q.key, q.config FROM curricula c
CROSS JOIN (VALUES
  ('bloom_gate', '{"max_remember_pct":20,"min_apply_plus_pct":50}'::jsonb),
  ('scenario_quota', '{"min_case_based_pct":30,"max_isolated_pct":20}'::jsonb),
  ('difficulty_cap', '{"max_easy_pct":15,"min_hardish_pct":40}'::jsonb),
  ('distractor_quality', '{"require_why_wrong":true,"require_why_tempting":true,"min_error_tags":2}'::jsonb),
  ('time_model', '{"warn_if_total_exceeds_pct":120}'::jsonb)
) AS q(key, config)
ON CONFLICT (curriculum_id, constraint_key) DO NOTHING;
