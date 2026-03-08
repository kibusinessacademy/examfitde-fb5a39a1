
-- Reset the 4 failed blueprint_generate_variants jobs to pending for re-dispatch
UPDATE job_queue
SET status = 'pending',
    error = NULL,
    last_error = NULL,
    completed_at = NULL,
    started_at = NULL,
    attempts = 0
WHERE job_type = 'blueprint_generate_variants'
  AND status = 'failed'
  AND created_at > now() - interval '4 hours';
