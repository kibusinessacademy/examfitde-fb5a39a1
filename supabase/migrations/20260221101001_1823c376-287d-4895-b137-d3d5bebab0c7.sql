-- Fix pipeline_step_order: Exam → Tutor → Oral
DELETE FROM pipeline_step_order;
INSERT INTO pipeline_step_order (job_type, step_index, required_package_step) VALUES
  ('package_scaffold_learning_course',  1,  ''),
  ('package_generate_glossary',         2,  'scaffold_learning_course'),
  ('package_generate_learning_content', 3,  'generate_glossary'),
  ('package_validate_learning_content', 4,  'generate_learning_content'),
  ('package_auto_seed_exam_blueprints', 5,  ''),
  ('package_validate_blueprints',       6,  'auto_seed_exam_blueprints'),
  ('package_generate_exam_pool',        7,  'validate_blueprints'),
  ('package_validate_exam_pool',        8,  'generate_exam_pool'),
  ('package_build_ai_tutor_index',      9,  'validate_exam_pool'),
  ('package_validate_tutor_index',     10,  'build_ai_tutor_index'),
  ('package_generate_oral_exam',       11,  'validate_tutor_index'),
  ('package_validate_oral_exam',       12,  'generate_oral_exam'),
  ('package_generate_handbook',        13,  'validate_oral_exam'),
  ('package_validate_handbook',        14,  'generate_handbook'),
  ('package_run_integrity_check',      15,  'validate_handbook'),
  ('package_quality_council',          16,  'run_integrity_check'),
  ('package_auto_publish',             17,  'quality_council');

-- Create or replace derive_pipeline_steps to enforce Exam → Tutor → Oral
CREATE OR REPLACE FUNCTION derive_pipeline_steps(p_flags jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_steps jsonb := '[]'::jsonb;
BEGIN
  IF (p_flags->>'has_learning_course')::boolean THEN
    v_steps := v_steps || '["scaffold_learning_course","generate_glossary","generate_learning_content","validate_learning_content"]'::jsonb;
  END IF;
  IF (p_flags->>'has_exam_trainer')::boolean THEN
    v_steps := v_steps || '["auto_seed_exam_blueprints","validate_blueprints","generate_exam_pool","validate_exam_pool"]'::jsonb;
  END IF;
  IF (p_flags->>'has_ai_tutor')::boolean THEN
    v_steps := v_steps || '["build_ai_tutor_index","validate_tutor_index"]'::jsonb;
  END IF;
  IF (p_flags->>'has_oral_exam_trainer')::boolean THEN
    v_steps := v_steps || '["generate_oral_exam","validate_oral_exam"]'::jsonb;
  END IF;
  IF (p_flags->>'has_handbook')::boolean THEN
    v_steps := v_steps || '["generate_handbook","validate_handbook"]'::jsonb;
  END IF;
  v_steps := v_steps || '["run_integrity_check","quality_council","auto_publish"]'::jsonb;
  RETURN v_steps;
END;
$$;