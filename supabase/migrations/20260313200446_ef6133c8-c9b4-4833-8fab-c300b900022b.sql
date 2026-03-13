
-- Cancel the last remaining pending exam_pool job
UPDATE job_queue 
SET status = 'cancelled', 
    updated_at = now(),
    locked_at = null,
    locked_by = null,
    last_error = 'CLEANUP: final pending job cancelled'
WHERE job_type = 'package_generate_exam_pool'
AND status IN ('pending', 'processing', 'queued');
