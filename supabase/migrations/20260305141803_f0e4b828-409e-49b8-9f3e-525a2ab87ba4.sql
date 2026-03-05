
-- Reset Präzisionswerkzeugmechaniker package from failed → building (post single-provider patch)

-- 1) Reset package status
UPDATE course_packages 
SET status = 'building', updated_at = now()
WHERE id = '65c74607-9f65-4b21-8fb9-a8c7f3aa3d92' AND status = 'failed';

-- 2) Re-queue the blocked generate_learning_content step
UPDATE package_steps 
SET status = 'queued', started_at = NULL, finished_at = NULL,
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"reset_reason": "manual_reset_post_patch_v6"}'::jsonb
WHERE package_id = '65c74607-9f65-4b21-8fb9-a8c7f3aa3d92'
  AND step_key = 'generate_learning_content';

-- 3) Cancel old failed lesson jobs
UPDATE job_queue
SET status = 'cancelled', 
    last_error = jsonb_build_object('reason', 'manual_reset_post_patch_v6', 'at', now()::text)
WHERE package_id = '65c74607-9f65-4b21-8fb9-a8c7f3aa3d92'
  AND job_type = 'lesson_generate_content'
  AND status = 'failed';

-- 4) Audit trail
INSERT INTO admin_actions (action, payload)
VALUES ('manual_reset_failed_package', jsonb_build_object(
  'package_id', '65c74607-9f65-4b21-8fb9-a8c7f3aa3d92',
  'reason', 'Pre-patch failures (multi-provider cascade + Gemini tool-mode). Reset to building for new single-provider code.',
  'at', now()::text
));
