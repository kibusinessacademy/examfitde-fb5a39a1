
-- Cancel ALL active jobs for the 6 stuck packages
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'bulk cancel: festgefahrene packages',
    updated_at = now()
WHERE package_id IN (
  SELECT id FROM course_packages WHERE id::text LIKE 'fd1d8192%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '59b6e214%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '2e8da39f%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '180c24a9%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '56aee54d%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '570ccb3e%'
)
AND status IN ('pending', 'queued', 'processing', 'failed', 'batch_pending');

-- Reset all non-done steps to queued for fresh restart
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL,
    meta = jsonb_set(
      COALESCE(meta, '{}'::jsonb),
      '{bulk_reset_at}',
      to_jsonb(now()::text)
    )
WHERE package_id IN (
  SELECT id FROM course_packages WHERE id::text LIKE 'fd1d8192%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '59b6e214%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '2e8da39f%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '180c24a9%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '56aee54d%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '570ccb3e%'
)
AND status NOT IN ('done', 'skipped');

-- Clear stuck_reason and ensure building status
UPDATE course_packages
SET status = 'building',
    stuck_reason = NULL,
    updated_at = now()
WHERE id IN (
  SELECT id FROM course_packages WHERE id::text LIKE 'fd1d8192%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '59b6e214%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '2e8da39f%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '180c24a9%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '56aee54d%'
  UNION SELECT id FROM course_packages WHERE id::text LIKE '570ccb3e%'
);

-- Audit log
INSERT INTO admin_actions (action, scope, payload)
VALUES (
  'bulk_cancel_stuck_packages',
  'pipeline_recovery',
  jsonb_build_object(
    'packages', ARRAY['fd1d8192','59b6e214','2e8da39f','180c24a9','56aee54d','570ccb3e'],
    'reason', 'User requested: alle Jobs für festgefahrene Kurse löschen',
    'actions', 'cancelled all active jobs, reset non-done steps to queued, set packages to building'
  )
);
