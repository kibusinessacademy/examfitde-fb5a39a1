
UPDATE job_queue
SET status = 'pending',
    error = NULL,
    last_error = NULL,
    completed_at = NULL,
    started_at = NULL,
    attempts = 0
WHERE job_type = 'blueprint_generate_variants'
  AND status = 'failed';
