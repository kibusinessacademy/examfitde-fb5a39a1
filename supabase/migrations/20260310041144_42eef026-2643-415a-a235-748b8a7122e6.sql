
-- Reset generate_handbook step + cancel dead jobs
UPDATE package_steps
SET status = 'queued', job_id = NULL, started_at = NULL, finished_at = NULL,
    attempts = 0, last_error = 'Fix: json/assertUuid waren undefiniert (ReferenceError)'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'generate_handbook';

UPDATE job_queue
SET status = 'cancelled',
    last_error = 'cancelled: function had ReferenceError, now fixed'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND job_type = 'package_generate_handbook'
  AND status = 'failed';
