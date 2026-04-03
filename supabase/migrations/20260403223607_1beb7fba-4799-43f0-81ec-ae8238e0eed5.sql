
-- KFZ: Force unblock via migration (bypasses triggers)
UPDATE public.package_steps
SET status = 'queued',
    last_error = NULL,
    meta = jsonb_build_object(
      'unblocked_at', now()::text,
      'unblocked_by', 'admin_migration_fix',
      'prev_loop_guard_reason', 'LOOP_GUARD: 30 failed jobs for validate_lesson_minichecks in last 24h (limit: 30)'
    )
WHERE package_id = '047bc325-5244-4f21-affd-5395bf62bcff'
AND step_key = 'validate_lesson_minichecks';

UPDATE public.course_packages
SET status = 'building',
    blocked_reason = NULL,
    last_error = NULL
WHERE id = '047bc325-5244-4f21-affd-5395bf62bcff';
