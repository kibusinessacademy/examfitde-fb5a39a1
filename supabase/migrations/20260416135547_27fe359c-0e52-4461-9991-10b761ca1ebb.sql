
-- Reset cancelled oral exam jobs for retry with fixed function
UPDATE job_queue
SET status = 'pending',
    started_at = NULL,
    completed_at = NULL,
    attempts = 0,
    last_error = 'RESET: ORAL_EXAM_INCOMPLETE coverage gap fixed — blueprint allocation now covers all competencies'
WHERE job_type = 'package_generate_oral_exam'
  AND status = 'cancelled'
  AND last_error LIKE '%ORAL_EXAM_INCOMPLETE%'
  AND completed_at > now() - interval '6 hours';

-- Also reset the corresponding package_steps back to queued
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL
WHERE step_key = 'generate_oral_exam'
  AND status = 'failed'
  AND package_id IN (
    SELECT DISTINCT package_id FROM job_queue
    WHERE job_type = 'package_generate_oral_exam'
      AND last_error LIKE '%RESET: ORAL_EXAM_INCOMPLETE%'
  );
