
-- ══════════════════════════════════════════════════════════════
-- fn_validate_blueprint_preflight: per-blueprint eligibility gate
-- Called before generate_blueprint_variants fan-out
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_validate_blueprint_preflight(p_blueprint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  bp record;
  hard_blockers text[] := '{}';
  soft_warnings text[] := '{}';
BEGIN
  SELECT * INTO bp FROM question_blueprints WHERE id = p_blueprint_id;

  IF bp IS NULL THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'hard_blockers', jsonb_build_array('blueprint_not_found'),
      'soft_warnings', '[]'::jsonb
    );
  END IF;

  -- ═══ HARD BLOCKERS (no fan-out allowed) ═══

  IF bp.status != 'approved' THEN
    hard_blockers := array_append(hard_blockers, 'not_approved');
  END IF;

  IF bp.competency_id IS NULL THEN
    hard_blockers := array_append(hard_blockers, 'missing_competency');
  END IF;

  IF bp.learning_field_id IS NULL THEN
    hard_blockers := array_append(hard_blockers, 'missing_learning_field');
  END IF;

  IF bp.cognitive_level IS NULL THEN
    hard_blockers := array_append(hard_blockers, 'missing_cognitive_level');
  END IF;

  IF bp.knowledge_type IS NULL THEN
    hard_blockers := array_append(hard_blockers, 'missing_knowledge_type');
  END IF;

  IF bp.canonical_statement IS NULL OR length(trim(bp.canonical_statement)) < 10 THEN
    hard_blockers := array_append(hard_blockers, 'empty_canonical_statement');
  END IF;

  IF bp.question_template IS NULL OR length(trim(bp.question_template)) < 10 THEN
    hard_blockers := array_append(hard_blockers, 'empty_question_template');
  END IF;

  IF bp.exam_relevance_score < 1 THEN
    hard_blockers := array_append(hard_blockers, 'zero_exam_relevance');
  END IF;

  -- ═══ SOFT WARNINGS (fan-out allowed, but flagged) ═══

  IF bp.trap_definition IS NULL OR bp.trap_definition = '{}'::jsonb THEN
    soft_warnings := array_append(soft_warnings, 'missing_trap_definition');
  END IF;

  IF bp.expected_trap_type IS NULL THEN
    soft_warnings := array_append(soft_warnings, 'missing_expected_trap_type');
  END IF;

  IF bp.typical_errors IS NULL OR bp.typical_errors = '[]'::jsonb THEN
    soft_warnings := array_append(soft_warnings, 'missing_typical_errors');
  END IF;

  IF bp.rubric IS NULL OR bp.rubric = '{}'::jsonb THEN
    soft_warnings := array_append(soft_warnings, 'missing_rubric');
  END IF;

  IF bp.variation_modes IS NULL OR array_length(bp.variation_modes, 1) IS NULL THEN
    soft_warnings := array_append(soft_warnings, 'missing_variation_modes');
  END IF;

  IF bp.exam_relevance_score <= 2 THEN
    soft_warnings := array_append(soft_warnings, 'low_exam_relevance');
  END IF;

  IF bp.scenario_type = 'isolated_knowledge' THEN
    soft_warnings := array_append(soft_warnings, 'isolated_knowledge_only');
  END IF;

  RETURN jsonb_build_object(
    'eligible', array_length(hard_blockers, 1) IS NULL,
    'hard_blockers', to_jsonb(hard_blockers),
    'soft_warnings', to_jsonb(soft_warnings)
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- v_blueprint_preflight_status: per-blueprint admin overview
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_blueprint_preflight_status AS
SELECT
  bp.id,
  bp.curriculum_id,
  bp.learning_field_id,
  bp.competency_id,
  bp.name,
  bp.status,
  bp.cognitive_level::text AS cognitive_level,
  bp.knowledge_type::text AS knowledge_type,
  bp.exam_relevance_score,
  bp.scenario_type,
  (fn_validate_blueprint_preflight(bp.id)->>'eligible')::boolean AS eligible,
  jsonb_array_length(fn_validate_blueprint_preflight(bp.id)->'hard_blockers') AS blocker_count,
  jsonb_array_length(fn_validate_blueprint_preflight(bp.id)->'soft_warnings') AS warning_count,
  fn_validate_blueprint_preflight(bp.id)->'hard_blockers' AS hard_blockers,
  fn_validate_blueprint_preflight(bp.id)->'soft_warnings' AS soft_warnings
FROM question_blueprints bp;

-- ══════════════════════════════════════════════════════════════
-- v_blueprint_preflight_summary: per-curriculum aggregate
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_blueprint_preflight_summary AS
SELECT
  bp.curriculum_id,
  count(*) AS total_blueprints,
  count(*) FILTER (WHERE (fn_validate_blueprint_preflight(bp.id)->>'eligible')::boolean) AS eligible,
  count(*) FILTER (WHERE NOT (fn_validate_blueprint_preflight(bp.id)->>'eligible')::boolean) AS blocked,
  count(*) FILTER (
    WHERE (fn_validate_blueprint_preflight(bp.id)->>'eligible')::boolean
    AND jsonb_array_length(fn_validate_blueprint_preflight(bp.id)->'soft_warnings') > 0
  ) AS with_warnings,
  round(
    count(*) FILTER (WHERE (fn_validate_blueprint_preflight(bp.id)->>'eligible')::boolean) * 100.0 / GREATEST(count(*), 1)
  ) AS eligibility_pct
FROM question_blueprints bp
WHERE bp.status IN ('draft', 'review', 'approved')
GROUP BY bp.curriculum_id;
