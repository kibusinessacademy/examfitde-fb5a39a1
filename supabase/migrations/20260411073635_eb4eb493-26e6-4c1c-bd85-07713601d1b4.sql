
-- Reset all stale locks (processing > 5 minutes)
UPDATE job_queue 
SET status = 'pending', locked_at = NULL, locked_by = NULL,
    updated_at = NOW()
WHERE status = 'processing' 
AND locked_at < NOW() - INTERVAL '5 minutes';
