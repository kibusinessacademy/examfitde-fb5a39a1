
-- Clean last violation on archived package
UPDATE package_steps
SET status = 'queued', job_id = NULL, last_error = 'CAUSALITY_REPAIR_FINAL', updated_at = NOW()
WHERE package_id = '94c579ad-d555-4afd-9e6a-7f88a9f71fc8'
  AND step_key = 'validate_oral_exam'
  AND status = 'done';
