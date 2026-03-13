
-- EMERGENCY: Cancel all active package_generate_exam_pool jobs to stop token burn
UPDATE job_queue 
SET status = 'cancelled', 
    updated_at = now(),
    last_error = 'EMERGENCY_CANCEL: infinite fan-out loop detected (212x same LF)'
WHERE job_type = 'package_generate_exam_pool'
AND status IN ('pending', 'processing', 'queued');
