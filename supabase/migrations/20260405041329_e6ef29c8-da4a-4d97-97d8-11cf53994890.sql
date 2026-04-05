
-- 1) BÜROMANAGEMENT: promote + reset
UPDATE course_packages
SET status = 'building', updated_at = now()
WHERE id = '5377ab93-fe17-488c-a266-bdb26b672da7' AND status = 'queued';

UPDATE package_steps
SET status = 'queued', started_at = NULL, finished_at = NULL, attempts = 0, last_error = NULL, updated_at = now()
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND step_key = 'validate_lesson_minichecks'
  AND status IN ('enqueued', 'failed');

UPDATE job_queue
SET status = 'cancelled', error = 'Manual repair: post-churn cleanup', updated_at = now()
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND job_type = 'package_validate_lesson_minichecks'
  AND status IN ('failed', 'pending');

-- 2) WIRTSCHAFTSINFORMATIK: reset failed job
UPDATE job_queue
SET status = 'pending', error = NULL, last_error = NULL, 
    run_after = now() + interval '30 seconds',
    locked_at = NULL, locked_by = NULL, updated_at = now()
WHERE package_id = 'c5000000-0004-4000-8000-000000000001'
  AND job_type = 'package_validate_blueprint_variants'
  AND status = 'failed';

-- 3) VERWALTUNGSFACHANGESTELLTE: cancel stuck processing + fix auto_publish
UPDATE job_queue
SET status = 'cancelled', error = 'Manual repair: zombie processing job', updated_at = now()
WHERE package_id = 'be7aa766-af51-445d-83d5-100a54007b39'
  AND job_type = 'package_generate_exam_pool'
  AND status = 'processing';

UPDATE job_queue
SET status = 'pending', error = NULL, last_error = NULL,
    run_after = now() + interval '10 seconds',
    locked_at = NULL, locked_by = NULL, updated_at = now()
WHERE package_id = 'be7aa766-af51-445d-83d5-100a54007b39'
  AND job_type = 'package_auto_publish'
  AND status = 'pending';

UPDATE package_steps
SET status = 'queued', started_at = NULL, finished_at = NULL, attempts = 0, updated_at = now()
WHERE package_id = 'be7aa766-af51-445d-83d5-100a54007b39'
  AND step_key = 'auto_publish'
  AND status = 'queued';

-- Audit
INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail)
VALUES
  ('manual_repair', 'promote_after_churn_fix', '5377ab93-fe17-488c-a266-bdb26b672da7', 'package', 'applied', 'Büromanagement: promoted to building after WIP churn fix'),
  ('manual_repair', 'reset_failed_job', 'c5000000-0004-4000-8000-000000000001', 'package', 'applied', 'Wirtschaftsinformatik: reset validate_blueprint_variants'),
  ('manual_repair', 'fix_auto_publish_block', 'be7aa766-af51-445d-83d5-100a54007b39', 'package', 'applied', 'Verwaltungsfachangestellte: cancelled zombie + fixed auto_publish');
