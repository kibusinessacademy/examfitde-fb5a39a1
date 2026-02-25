
-- =============================================
-- 4-LAYER PREMIUM UPGRADE SCHEMA
-- =============================================

-- === LAYER 1: Transfer-Overlay ===
-- Extend blueprints for cross-competency scenarios
ALTER TABLE question_blueprints
  ADD COLUMN IF NOT EXISTS scenario_type text NOT NULL DEFAULT 'single_competency',
  ADD COLUMN IF NOT EXISTS linked_competency_ids uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cross_lf_references uuid[] DEFAULT '{}';

COMMENT ON COLUMN question_blueprints.scenario_type IS 'single_competency | combined_decision | calculation_chain | conflict_resolution';
COMMENT ON COLUMN question_blueprints.linked_competency_ids IS 'Additional competencies involved in cross-competency scenarios';
COMMENT ON COLUMN question_blueprints.cross_lf_references IS 'Learning fields connected in transfer scenarios';

-- === LAYER 2: Very-Hard Rekalibrierung ===
ALTER TABLE question_blueprints
  ADD COLUMN IF NOT EXISTS very_hard_criteria jsonb DEFAULT null;

COMMENT ON COLUMN question_blueprints.very_hard_criteria IS 'Structure: {conflict_type, min_competency_areas, requires_decision_justification, incomplete_information, trade_off_dimensions[]}';

-- === LAYER 3: Oral-Trainer Depth ===
ALTER TABLE oral_exam_blueprints
  ADD COLUMN IF NOT EXISTS followup_depth smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS stress_config jsonb DEFAULT null,
  ADD COLUMN IF NOT EXISTS dual_examiner_roles jsonb DEFAULT null,
  ADD COLUMN IF NOT EXISTS scoring_weights jsonb DEFAULT null;

COMMENT ON COLUMN oral_exam_blueprints.stress_config IS '{level: 1-5, time_pressure: bool, ambiguous_question: bool, pushback_intensity: mild|moderate|strong}';
COMMENT ON COLUMN oral_exam_blueprints.dual_examiner_roles IS '{examiner_a: {role, focus_area}, examiner_b: {role, focus_area}}';
COMMENT ON COLUMN oral_exam_blueprints.scoring_weights IS '{fachlichkeit: 0.3, struktur: 0.25, begriffssicherheit: 0.25, praxisbezug: 0.2}';

ALTER TABLE oral_exam_session_templates
  ADD COLUMN IF NOT EXISTS stress_level smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS examiner_mode text NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS followup_chains jsonb DEFAULT null,
  ADD COLUMN IF NOT EXISTS scoring_rubric_detailed jsonb DEFAULT null;

COMMENT ON COLUMN oral_exam_session_templates.examiner_mode IS 'single | dual_cooperative | dual_adversarial';
COMMENT ON COLUMN oral_exam_session_templates.followup_chains IS 'Array of {trigger_condition, followup_question, expected_depth, scoring_dimension}';

-- === LAYER 4: Wirtschaftlichkeits-Boost ===
ALTER TABLE question_blueprints
  ADD COLUMN IF NOT EXISTS economic_scenario_type text DEFAULT null;

COMMENT ON COLUMN question_blueprints.economic_scenario_type IS 'calculation_chain | margin_decision | contribution_margin | assortment_strategy | cost_comparison';

-- === UPGRADE ORCHESTRATION ===
CREATE TABLE IF NOT EXISTS premium_upgrade_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES course_packages(id),
  curriculum_id uuid NOT NULL,
  layer text NOT NULL CHECK (layer IN ('transfer_overlay', 'very_hard_recal', 'oral_depth', 'economic_boost')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed', 'skipped')),
  target_config jsonb NOT NULL DEFAULT '{}',
  progress jsonb NOT NULL DEFAULT '{"completed": 0, "total": 0, "errors": []}',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(package_id, layer)
);

ALTER TABLE premium_upgrade_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on premium_upgrade_runs"
  ON premium_upgrade_runs FOR ALL
  USING (true) WITH CHECK (true);

COMMENT ON TABLE premium_upgrade_runs IS 'Tracks per-layer upgrade progress for each package. SSOT for upgrade orchestration.';

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_premium_upgrade_runs_package ON premium_upgrade_runs(package_id, layer);
CREATE INDEX IF NOT EXISTS idx_blueprints_scenario_type ON question_blueprints(scenario_type) WHERE scenario_type != 'single_competency';
CREATE INDEX IF NOT EXISTS idx_blueprints_economic ON question_blueprints(economic_scenario_type) WHERE economic_scenario_type IS NOT NULL;

-- === HELPER: Count blueprints needing upgrade ===
CREATE OR REPLACE FUNCTION count_upgrade_candidates(
  p_curriculum_id uuid,
  p_layer text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  CASE p_layer
    WHEN 'transfer_overlay' THEN
      SELECT jsonb_build_object(
        'total_blueprints', count(*),
        'single_competency', count(*) FILTER (WHERE scenario_type = 'single_competency'),
        'already_combined', count(*) FILTER (WHERE scenario_type != 'single_competency'),
        'lf_count', (SELECT count(DISTINCT id) FROM learning_fields WHERE curriculum_id = p_curriculum_id)
      ) INTO result
      FROM question_blueprints WHERE curriculum_id = p_curriculum_id;
      
    WHEN 'very_hard_recal' THEN
      SELECT jsonb_build_object(
        'total_blueprints', count(*),
        'has_criteria', count(*) FILTER (WHERE very_hard_criteria IS NOT NULL),
        'needs_criteria', count(*) FILTER (WHERE very_hard_criteria IS NULL AND cognitive_level IN ('analyze', 'evaluate')),
        'current_very_hard', count(*) FILTER (WHERE exam_relevance_score >= 8)
      ) INTO result
      FROM question_blueprints WHERE curriculum_id = p_curriculum_id;

    WHEN 'oral_depth' THEN
      SELECT jsonb_build_object(
        'total_blueprints', (SELECT count(*) FROM oral_exam_blueprints WHERE curriculum_id = p_curriculum_id),
        'total_templates', (SELECT count(*) FROM oral_exam_session_templates WHERE curriculum_id = p_curriculum_id),
        'low_followup', (SELECT count(*) FROM oral_exam_blueprints WHERE curriculum_id = p_curriculum_id AND followup_depth <= 2),
        'no_stress_config', (SELECT count(*) FROM oral_exam_blueprints WHERE curriculum_id = p_curriculum_id AND stress_config IS NULL)
      ) INTO result;

    WHEN 'economic_boost' THEN
      SELECT jsonb_build_object(
        'total_blueprints', count(*),
        'has_economic', count(*) FILTER (WHERE economic_scenario_type IS NOT NULL),
        'needs_economic', count(*) FILTER (WHERE economic_scenario_type IS NULL AND knowledge_type = 'procedural'),
        'calculation_blueprints', count(*) FILTER (WHERE 'calculation' = ANY(allowed_question_types))
      ) INTO result
      FROM question_blueprints WHERE curriculum_id = p_curriculum_id;

    ELSE
      result := '{"error": "unknown layer"}'::jsonb;
  END CASE;

  RETURN result;
END;
$$;
