
-- Cancel all active jobs in the queue
UPDATE job_queue 
SET status = 'cancelled', 
    completed_at = now(), 
    error = 'Manual purge: queue reset by admin 2026-03-22'
WHERE status IN ('pending', 'queued', 'processing', 'running', 'batch_pending');

-- Also release any active package leases so dispatcher can re-lease
DELETE FROM package_leases WHERE lease_until > now();
