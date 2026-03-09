
-- OPERATIONAL FIX 3: Cancel (not reset to pending) old stale-lock failed jobs
-- Using cancelled status to avoid idempotency_key conflicts
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'Cleaned up: pre-fix stale-lock burn victim'
WHERE last_error LIKE '%Stale lock%max attempts%reached%'
  AND status = 'failed'
  AND updated_at > now() - interval '6 hours';
