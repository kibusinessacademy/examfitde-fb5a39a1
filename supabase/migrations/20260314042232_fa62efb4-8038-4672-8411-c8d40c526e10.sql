
-- Fix ops_jobtype_step_map to be complete (all 23 pipeline steps)
CREATE OR REPLACE VIEW ops_jobtype_step_map AS
SELECT job_type, step_key
FROM (VALUES
  ('package_scaffold_learning_course'::text, 'scaffold_learning_course'::text),
  ('package_generate_glossary', 'generate_glossary'),
  ('package_generate_learning_content', 'generate_learning_content'),
  ('package_validate_learning_content', 'validate_learning_content'),
  ('package_auto_seed_exam_blueprints', 'auto_seed_exam_blueprints'),
  ('package_validate_blueprints', 'validate_blueprints'),
  ('package_generate_exam_pool', 'generate_exam_pool'),
  ('package_validate_exam_pool', 'validate_exam_pool'),
  ('package_build_ai_tutor_index', 'build_ai_tutor_index'),
  ('package_validate_tutor_index', 'validate_tutor_index'),
  ('package_generate_oral_exam', 'generate_oral_exam'),
  ('package_validate_oral_exam', 'validate_oral_exam'),
  ('package_generate_lesson_minichecks', 'generate_lesson_minichecks'),
  ('package_validate_lesson_minichecks', 'validate_lesson_minichecks'),
  ('package_generate_handbook', 'generate_handbook'),
  ('package_validate_handbook', 'validate_handbook'),
  ('package_enqueue_handbook_expand', 'enqueue_handbook_expand'),
  ('handbook_expand_section', 'expand_handbook'),
  ('package_validate_handbook_depth', 'validate_handbook_depth'),
  ('package_elite_harden', 'elite_harden'),
  ('package_run_integrity_check', 'run_integrity_check'),
  ('package_quality_council', 'quality_council'),
  ('package_auto_publish', 'auto_publish')
) t(job_type, step_key);

-- SSOT Drift Guard: View that detects step_keys without job mapping
-- Queryable by watchdog/admin for instant drift detection
CREATE OR REPLACE VIEW ops_step_mapping_drift AS
SELECT DISTINCT ps.step_key,
  CASE WHEN m.step_key IS NULL THEN 'MISSING_IN_VIEW' ELSE 'OK' END AS view_status,
  CASE WHEN jq.job_type IS NULL THEN 'NO_JOBS_EVER' ELSE 'HAS_JOBS' END AS job_history
FROM package_steps ps
LEFT JOIN ops_jobtype_step_map m ON m.step_key = ps.step_key
LEFT JOIN LATERAL (
  SELECT DISTINCT job_type FROM job_queue 
  WHERE job_type = 'package_' || ps.step_key
  LIMIT 1
) jq ON true
ORDER BY ps.step_key;
