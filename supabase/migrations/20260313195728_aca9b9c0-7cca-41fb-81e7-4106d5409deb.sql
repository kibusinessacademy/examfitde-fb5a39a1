
-- Final cancel: remaining active exam_pool jobs after v3 deploy
UPDATE job_queue 
SET status = 'cancelled', 
    updated_at = now(),
    locked_at = null,
    locked_by = null,
    last_error = 'EMERGENCY_CANCEL_v3_final: dedup guard v3 active'
WHERE job_type = 'package_generate_exam_pool'
AND status IN ('pending', 'processing', 'queued');
