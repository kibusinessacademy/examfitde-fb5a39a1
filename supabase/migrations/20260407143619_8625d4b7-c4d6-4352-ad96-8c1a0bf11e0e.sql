
UPDATE package_steps
SET status = 'done',
    finished_at = now(),
    started_at = COALESCE(started_at, now()),
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"manual_finalized": true, "finalized_at": "2026-04-07T14:36:00Z"}'::jsonb
WHERE package_id = '24c3793c-30b0-43a7-bd5d-cfed0c40542d'
  AND step_key = 'fanout_learning_content'
  AND status = 'queued';
