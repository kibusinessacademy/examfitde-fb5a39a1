-- 1. Cancel ALL jobs for Verkäufer package
UPDATE job_queue
SET status = 'cancelled',
    completed_at = now(),
    updated_at = now(),
    last_error = 'manual_reset: full queue flush for fresh restart'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND status IN ('pending', 'queued', 'processing', 'failed');

-- 2. Delete stale lease
DELETE FROM package_leases
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04';

-- 3. Reset generate_handbook step to fresh queued
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    started_at = NULL,
    updated_at = now(),
    last_error = NULL,
    meta = jsonb_build_object('manual_reset', true, 'reset_at', now()::text)
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'generate_handbook';

-- 4. Ensure package is building and queue-ready
UPDATE course_packages
SET status = 'building',
    updated_at = now()
WHERE id = '59b6e214-e181-4c2b-986e-1ce544984d04';