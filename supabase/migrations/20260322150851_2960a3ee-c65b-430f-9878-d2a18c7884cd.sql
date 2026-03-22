-- Unblock Steuerfachangestellter and reset auto_publish step for manual publish
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND status = 'blocked';

UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('manual_unblock', true, 'manual_unblock_at', now()::text),
    updated_at = now()
WHERE package_id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND step_key = 'auto_publish';