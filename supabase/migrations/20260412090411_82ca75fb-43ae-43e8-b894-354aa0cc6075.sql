
-- 1) Reset stuck integrity_check processing job
UPDATE job_queue
SET status = 'pending', locked_at = NULL, locked_by = NULL,
    last_error = 'MANUAL_RESET: awaiting upstream oral_exam completion'
WHERE id = 'fa2146d5-072f-44c2-94af-a06b4a7a426e'
AND status = 'processing';

-- 2) Reset all stale processing jobs > 5min
UPDATE job_queue
SET status = 'pending', locked_at = NULL, locked_by = NULL,
    last_error = 'STALE_RESET_v3: ' || COALESCE(last_error, 'none')
WHERE status = 'processing'
AND locked_at < now() - interval '5 minutes';
