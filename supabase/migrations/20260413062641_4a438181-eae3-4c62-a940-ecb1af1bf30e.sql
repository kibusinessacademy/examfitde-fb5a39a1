
-- Reset stale processing jobs so they can be re-dispatched under corrected tier classification
UPDATE job_queue
SET status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    started_at = NULL,
    last_heartbeat_at = NULL,
    updated_at = now(),
    last_error = 'ADMIN_RESET: tier reclassification v6.0 — BUDGET_EXHAUSTED fix'
WHERE status = 'processing'
  AND started_at < now() - interval '3 minutes';
