
-- Reset stale processing jobs for Mechatroniker that got stuck on BUDGET_EXHAUSTED
UPDATE job_queue
SET status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now(),
    last_error = 'STALE_BUDGET_RESET: was stuck processing after BUDGET_EXHAUSTED fast-release failure'
WHERE package_id = '2e8da39f-60f8-44d9-8b70-e1176222ca55'
  AND status = 'processing'
  AND last_error ILIKE '%BUDGET_EXHAUSTED%';
