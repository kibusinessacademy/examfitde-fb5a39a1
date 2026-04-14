
-- Unblock Spedition
UPDATE course_packages 
SET status = 'building', blocked_reason = NULL, updated_at = now()
WHERE id = '259894ef-5d62-4692-bd21-a8250fe4b389' AND status = 'blocked';

-- Reset validate_exam_pool to allow fresh run
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    updated_at = now(),
    meta = jsonb_build_object(
      'ok', false,
      'reset_reason', 'admin_unblock_spedition',
      'reset_at', now()::text
    )
WHERE package_id = '259894ef-5d62-4692-bd21-a8250fe4b389'
  AND step_key = 'validate_exam_pool'
  AND status IN ('queued', 'failed', 'blocked');
