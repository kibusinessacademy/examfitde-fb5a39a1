
-- Ghost-Completion Monitor View
-- Detects steps where jobs completed but step not finalized
CREATE OR REPLACE VIEW public.ops_ghost_completion_monitor AS
WITH step_job_map(step_key, job_type) AS (VALUES
  ('scaffold_learning_course', 'package_scaffold_learning_course'),
  ('generate_glossary', 'package_generate_glossary'),
  ('fanout_learning_content', 'package_fanout_learning_content'),
  ('generate_learning_content', 'package_generate_learning_content'),
  ('finalize_learning_content', 'package_finalize_learning_content'),
  ('validate_learning_content', 'package_validate_learning_content'),
  ('auto_seed_exam_blueprints', 'package_auto_seed_exam_blueprints'),
  ('validate_blueprints', 'package_validate_blueprints'),
  ('generate_blueprint_variants', 'package_generate_blueprint_variants'),
  ('validate_blueprint_variants', 'package_validate_blueprint_variants'),
  ('promote_blueprint_variants', 'package_promote_blueprint_variants'),
  ('generate_exam_pool', 'package_generate_exam_pool'),
  ('validate_exam_pool', 'package_validate_exam_pool'),
  ('repair_exam_pool_quality', 'package_repair_exam_pool_quality'),
  ('build_ai_tutor_index', 'package_build_ai_tutor_index'),
  ('validate_tutor_index', 'package_validate_tutor_index'),
  ('generate_oral_exam', 'package_generate_oral_exam'),
  ('validate_oral_exam', 'package_validate_oral_exam'),
  ('generate_lesson_minichecks', 'package_generate_lesson_minichecks'),
  ('validate_lesson_minichecks', 'package_validate_lesson_minichecks'),
  ('generate_handbook', 'package_generate_handbook'),
  ('validate_handbook', 'package_validate_handbook'),
  ('enqueue_handbook_expand', 'package_enqueue_handbook_expand'),
  ('expand_handbook', 'handbook_expand_section'),
  ('validate_handbook_depth', 'package_validate_handbook_depth'),
  ('elite_harden', 'package_elite_harden'),
  ('run_integrity_check', 'package_run_integrity_check'),
  ('quality_council', 'package_quality_council'),
  ('auto_publish', 'package_auto_publish')
)
SELECT
  ps.step_key,
  ps.status AS step_status,
  ps.package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  completed_jobs.cnt AS completed_job_count,
  (ps.meta->>'ok')::boolean AS has_meta_ok,
  (ps.meta->>'batch_complete')::boolean AS has_meta_batch_complete,
  (ps.meta->>'validation_passed')::boolean AS has_meta_validation_passed,
  ps.started_at,
  ps.updated_at AS step_updated_at,
  completed_jobs.latest_completed_at
FROM package_steps ps
JOIN step_job_map sjm ON sjm.step_key = ps.step_key
JOIN course_packages cp ON cp.id = ps.package_id
CROSS JOIN LATERAL (
  SELECT COUNT(*) AS cnt, MAX(jq.updated_at) AS latest_completed_at
  FROM job_queue jq
  WHERE jq.package_id = ps.package_id
    AND jq.job_type = sjm.job_type
    AND jq.status = 'completed'
) completed_jobs
WHERE ps.status NOT IN ('done', 'skipped')
  AND completed_jobs.cnt > 0;

COMMENT ON VIEW public.ops_ghost_completion_monitor IS 'Detects ghost-completion: steps with completed jobs but not finalized. Should be empty in healthy state.';
