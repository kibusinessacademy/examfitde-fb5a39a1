
UPDATE public.package_steps
SET status = 'queued',
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"allow_regression": true, "allow_regression_by": "admin_manual"}'::jsonb,
    updated_at = now()
WHERE package_id = 'c5000000-0004-4000-8000-000000000001'
  AND step_key = 'validate_blueprints'
  AND status = 'done'
  AND last_error LIKE '%Waiting for%';
