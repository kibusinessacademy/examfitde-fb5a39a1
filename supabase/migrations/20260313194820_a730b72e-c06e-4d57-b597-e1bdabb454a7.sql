
-- Cancel remaining active exam_pool jobs (pending + processing)
UPDATE job_queue 
SET status = 'cancelled', 
    updated_at = now(),
    locked_at = null,
    locked_by = null,
    last_error = 'EMERGENCY_CANCEL_v2: stopping infinite fan-out loop'
WHERE job_type = 'package_generate_exam_pool'
AND status IN ('pending', 'processing');
