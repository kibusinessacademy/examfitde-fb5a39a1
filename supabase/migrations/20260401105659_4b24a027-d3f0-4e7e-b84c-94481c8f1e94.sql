CREATE OR REPLACE FUNCTION public.get_artifact_threshold(
  p_step_key TEXT,
  p_artifact TEXT,
  p_context JSONB DEFAULT '{}'::jsonb
) RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_lf_count INTEGER;
  v_comp_count INTEGER;
  v_chapter_count INTEGER;
  v_section_count INTEGER;
  v_exam_target INTEGER;
BEGIN
  v_lf_count := COALESCE((p_context->>'learningFieldCount')::int, 1);
  v_comp_count := COALESCE((p_context->>'competencyCount')::int, 5);
  v_chapter_count := COALESCE((p_context->>'chapterCount')::int, 1);
  v_section_count := COALESCE((p_context->>'sectionCount')::int, 1);
  v_exam_target := COALESCE((p_context->>'examTarget')::int, 1000);

  CASE p_step_key
    WHEN 'scaffold_learning_course' THEN
      IF p_artifact = 'modules' THEN RETURN GREATEST(1, v_lf_count);
      ELSIF p_artifact = 'lessons' THEN RETURN GREATEST(5, v_comp_count);
      END IF;
    WHEN 'auto_seed_exam_blueprints' THEN
      RETURN GREATEST(3, GREATEST(10, v_lf_count * 2));
    WHEN 'generate_exam_pool' THEN
      RETURN GREATEST(50, (v_exam_target * 5) / 100);
    WHEN 'generate_handbook' THEN
      RETURN GREATEST(1, v_chapter_count);
    WHEN 'expand_handbook' THEN
      RETURN GREATEST(1, CEIL(v_section_count * 0.8)::int);
    WHEN 'generate_glossary' THEN RETURN 1;
    WHEN 'generate_learning_content' THEN RETURN 600;
    WHEN 'generate_oral_exam' THEN RETURN 10;
    WHEN 'generate_lesson_minichecks' THEN RETURN 5;
    WHEN 'build_ai_tutor_index' THEN RETURN 1;
    WHEN 'run_integrity_check' THEN RETURN 2;
    WHEN 'validate_blueprints' THEN RETURN 10;
    WHEN 'validate_oral_exam' THEN RETURN 10;
    WHEN 'validate_exam_pool' THEN RETURN 50;
    WHEN 'validate_lesson_minichecks' THEN RETURN 1;
    WHEN 'validate_handbook' THEN RETURN 3;
    WHEN 'validate_tutor_index' THEN RETURN 1;
    WHEN 'validate_learning_content' THEN RETURN 1;
    ELSE RETURN 0;
  END CASE;
  RETURN 0;
END;
$$;