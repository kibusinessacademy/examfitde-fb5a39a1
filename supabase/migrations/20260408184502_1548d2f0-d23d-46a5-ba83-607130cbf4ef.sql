
-- Correct get_step_prerequisite to match PIPELINE_GRAPH SSOT exactly
-- This function should return ONE prereq (the primary dependency).
-- For steps with multiple DAG parents, return the most critical one.
CREATE OR REPLACE FUNCTION public.get_step_prerequisite(p_step_key text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_step_key
    -- Phase 1: Scaffold + Content
    WHEN 'scaffold_learning_course' THEN RETURN NULL;
    WHEN 'generate_glossary' THEN RETURN 'scaffold_learning_course';
    WHEN 'fanout_learning_content' THEN RETURN 'scaffold_learning_course';
    WHEN 'generate_learning_content' THEN RETURN 'fanout_learning_content';
    WHEN 'finalize_learning_content' THEN RETURN 'generate_learning_content';
    WHEN 'validate_learning_content' THEN RETURN 'finalize_learning_content';
    -- Phase 2: Blueprints + Variants
    WHEN 'auto_seed_exam_blueprints' THEN RETURN 'validate_learning_content';
    WHEN 'validate_blueprints' THEN RETURN 'auto_seed_exam_blueprints';
    WHEN 'generate_blueprint_variants' THEN RETURN 'validate_blueprints';
    WHEN 'validate_blueprint_variants' THEN RETURN 'generate_blueprint_variants';
    WHEN 'promote_blueprint_variants' THEN RETURN 'validate_blueprint_variants';
    -- Phase 3: Exam Pool
    WHEN 'generate_exam_pool' THEN RETURN 'promote_blueprint_variants';
    WHEN 'validate_exam_pool' THEN RETURN 'generate_exam_pool';
    WHEN 'repair_exam_pool_quality' THEN RETURN 'generate_exam_pool';
    -- Phase 4: PARALLEL after validate_exam_pool / validate_learning_content
    WHEN 'build_ai_tutor_index' THEN RETURN 'validate_exam_pool';
    WHEN 'validate_tutor_index' THEN RETURN 'build_ai_tutor_index';
    WHEN 'generate_oral_exam' THEN RETURN 'validate_tutor_index';  -- needs validated_tutor_index!
    WHEN 'validate_oral_exam' THEN RETURN 'generate_oral_exam';
    WHEN 'generate_lesson_minichecks' THEN RETURN 'validate_learning_content';
    WHEN 'validate_lesson_minichecks' THEN RETURN 'generate_lesson_minichecks';
    WHEN 'generate_handbook' THEN RETURN 'validate_learning_content';
    WHEN 'validate_handbook' THEN RETURN 'generate_handbook';
    WHEN 'enqueue_handbook_expand' THEN RETURN 'validate_handbook';
    WHEN 'expand_handbook' THEN RETURN 'enqueue_handbook_expand';
    WHEN 'validate_handbook_depth' THEN RETURN 'expand_handbook';
    WHEN 'elite_harden' THEN RETURN 'validate_exam_pool';
    -- Phase 5: Finalization (convergence gate — has multiple DAG parents)
    WHEN 'run_integrity_check' THEN RETURN 'elite_harden';  -- primary; DAG also requires validate_oral_exam etc.
    WHEN 'quality_council' THEN RETURN 'run_integrity_check';
    WHEN 'auto_publish' THEN RETURN 'quality_council';
    ELSE RETURN NULL;
  END CASE;
END;
$$;
