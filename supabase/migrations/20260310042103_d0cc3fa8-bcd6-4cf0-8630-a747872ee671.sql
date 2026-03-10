UPDATE package_steps
SET status = 'queued', job_id = NULL, started_at = NULL,
    attempts = 0, last_error = 'Fix: prereqDone war undefiniert (ReferenceError)'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'generate_handbook';

UPDATE job_queue
SET status = 'cancelled',
    last_error = 'cancelled: prereqDone ReferenceError fixed'
WHERE id = '54a8e3ea-3f80-4aaf-9386-fbd2c502e093'
  AND status = 'failed';