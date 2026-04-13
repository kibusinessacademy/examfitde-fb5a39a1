
-- v6.1: Reset stale processing jobs that are blocking FINISH_LINE_GUARD caps
-- These accumulated because of BUDGET_EXHAUSTED loops in v6.0
UPDATE job_queue
SET status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    started_at = NULL,
    last_heartbeat_at = NULL,
    updated_at = now(),
    last_error = 'ADMIN_RESET: v6.1 stale processing cleanup — FINISH_LINE_GUARD unblock'
WHERE status = 'processing'
  AND started_at < now() - interval '3 minutes';
