-- Fix: Add missing fanout_learning_content and finalize_learning_content to ops_jobtype_step_map
CREATE OR REPLACE VIEW public.ops_jobtype_step_map AS
SELECT job_type, step_key
FROM (VALUES
  ('package_scaffold_learning_course',  'scaffold_learning_course'),
  ('package_generate_glossary',         'generate_glossary'),
  ('package_fanout_learning_content',   'fanout_learning_content'),
  ('package_generate_learning_content', 'generate_learning_content'),
  ('package_finalize_learning_content', 'finalize_learning_content'),
  ('package_validate_learning_content', 'validate_learning_content'),
  ('package_auto_seed_exam_blueprints', 'auto_seed_exam_blueprints'),
  ('package_validate_blueprints',       'validate_blueprints'),
  ('package_generate_exam_pool',        'generate_exam_pool'),
  ('package_validate_exam_pool',        'validate_exam_pool'),
  ('package_build_ai_tutor_index',      'build_ai_tutor_index'),
  ('package_validate_tutor_index',      'validate_tutor_index'),
  ('package_generate_oral_exam',        'generate_oral_exam'),
  ('package_validate_oral_exam',        'validate_oral_exam'),
  ('package_generate_lesson_minichecks','generate_lesson_minichecks'),
  ('package_validate_lesson_minichecks','validate_lesson_minichecks'),
  ('package_generate_handbook',         'generate_handbook'),
  ('package_validate_handbook',         'validate_handbook'),
  ('package_enqueue_handbook_expand',   'enqueue_handbook_expand'),
  ('handbook_expand_section',           'expand_handbook'),
  ('package_validate_handbook_depth',   'validate_handbook_depth'),
  ('package_elite_harden',              'elite_harden'),
  ('package_run_integrity_check',       'run_integrity_check'),
  ('package_quality_council',           'quality_council'),
  ('package_auto_publish',              'auto_publish')
) AS t(job_type, step_key);

NOTIFY pgrst, 'reload schema';