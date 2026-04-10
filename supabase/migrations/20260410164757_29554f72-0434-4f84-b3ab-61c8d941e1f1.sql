
-- 1. Reset the stuck Wirtschaftsinformatik quality_council job
UPDATE job_queue
SET status = 'pending', attempts = 0, 
    last_error = 'ADMIN_RESET: stale_lock_recovery loop cleared',
    updated_at = NOW()
WHERE id = '4f9d5c51-9af1-4005-8e92-2843fe7a7bf1'
  AND status = 'processing';

-- 2. Fix Fachinformatiker AE: reset step from failed to queued
UPDATE package_steps
SET status = 'queued', updated_at = NOW()
WHERE package_id = '24c3793c-30b0-43a7-bd5d-cfed0c40542d'
  AND step_key = 'generate_lesson_minichecks'
  AND status = 'failed';
