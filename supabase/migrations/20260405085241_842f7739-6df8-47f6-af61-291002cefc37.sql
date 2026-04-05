
UPDATE public.package_steps
SET status = 'queued',
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"allow_regression": true, "reset_reason": "watchdog_timeout_after_fk_repair"}'::jsonb
WHERE package_id = 'c5000000-0004-4000-8000-000000000001'
  AND step_key = 'auto_seed_exam_blueprints'
  AND status = 'running';
