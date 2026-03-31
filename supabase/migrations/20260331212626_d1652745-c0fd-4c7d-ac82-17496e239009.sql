
UPDATE job_queue
SET status = 'pending', attempts = 0, last_error = NULL, last_error_code = NULL, locked_at = NULL, locked_by = NULL
WHERE job_type = 'package_fanout_learning_content'
  AND status IN ('failed')
  AND last_error LIKE '%400%';

UPDATE job_queue
SET attempts = 0, last_error = NULL
WHERE job_type = 'package_fanout_learning_content'
  AND status = 'pending'
  AND attempts >= 3;
