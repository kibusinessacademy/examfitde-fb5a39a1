-- First: unblock the package to building state
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND status = 'blocked';

-- Reset auto_publish step
UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    updated_at = now()
WHERE package_id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND step_key = 'auto_publish';

-- Reset integrity step to queued so it can be re-run
UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    updated_at = now()
WHERE package_id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND step_key = 'run_integrity_check';