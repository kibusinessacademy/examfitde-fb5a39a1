
-- Fix Kauffrau Büromanagement (5377ab93): HOLLOW exam pipeline
-- Root cause: 0 blueprints → generate_exam_pool HOLLOW_COMPLETION → watchdog falsely marked done
-- Fix: Reset blueprint + exam pool steps to re-run with hardened code

-- 1) Reset exam-related steps to queued
UPDATE package_steps
SET status = 'queued', started_at = NULL, finished_at = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'reset_reason', 'hollow_exam_pipeline_0_blueprints',
      'reset_at', now()::text,
      'prev_status', status
    )
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND step_key IN ('auto_seed_exam_blueprints', 'validate_blueprints', 'generate_exam_pool', 'validate_exam_pool');

-- 2) Cancel the stuck pending validate job
UPDATE job_queue
SET status = 'cancelled',
    last_error = jsonb_build_object('reason', 'hollow_exam_reset', 'at', now()::text),
    updated_at = now()
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND job_type = 'package_validate_exam_pool'
  AND status = 'pending';

-- 3) Audit trail
INSERT INTO admin_actions (action, payload)
VALUES ('reset_hollow_exam_pipeline', jsonb_build_object(
  'package_id', '5377ab93-fe17-488c-a266-bdb26b672da7',
  'curriculum_id', '33eb7832-8c80-46fa-a3ad-a9a5ee996e87',
  'reason', '0 blueprints + 10 HOLLOW questions → watchdog falsely marked done. Reset from blueprint seeding.',
  'at', now()::text
));
