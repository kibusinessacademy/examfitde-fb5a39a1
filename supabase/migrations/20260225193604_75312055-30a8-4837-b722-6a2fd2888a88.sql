
-- Fix: use correct enum value 'procedure' instead of 'procedural'
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
        'needs_economic', count(*) FILTER (WHERE economic_scenario_type IS NULL AND knowledge_type = 'calculation'),
        'calculation_blueprints', count(*) FILTER (WHERE 'calculation' = ANY(allowed_question_types))
      ) INTO result
      FROM question_blueprints WHERE curriculum_id = p_curriculum_id;

    ELSE
      result := '{"error": "unknown layer"}'::jsonb;
  END CASE;

  RETURN result;
END;
$$;
