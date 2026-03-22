-- Mark integrity check as done (report is persisted and verified)
UPDATE package_steps
SET status = 'done',
    started_at = COALESCE(started_at, now()),
    attempts = COALESCE(attempts, 0) + 1,
    last_error = NULL,
    updated_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || '{"manual_finalized": true, "manual_finalized_at": "2026-03-22T15:10:00Z"}'::jsonb
WHERE package_id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND step_key = 'run_integrity_check';