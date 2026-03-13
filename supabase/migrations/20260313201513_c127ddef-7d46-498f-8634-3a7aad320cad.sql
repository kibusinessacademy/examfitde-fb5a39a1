
-- FINAL CLEANUP: Cancel ALL remaining exam_pool jobs (processing zombies + any stragglers)
UPDATE job_queue 
SET status = 'cancelled', 
    locked_at = null,
    locked_by = null,
    last_error = 'FINAL_CLEANUP: zombie processing jobs cancelled'
WHERE job_type IN ('package_generate_exam_pool', 'package_validate_exam_pool')
AND status IN ('pending', 'processing', 'queued');
