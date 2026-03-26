
-- ============================================================
-- SYSTEM-WIDE FIX: Unblock packages + clean failed jobs
-- ============================================================

-- 1. fd1d8192 (Elektroniker): integrity_passed=true, council_approved=true
--    auto_publish step stuck on stale gate snapshot → reset step + unblock
UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    meta = meta || jsonb_build_object(
      'system_heal_at', now()::text,
      'system_heal_reason', 'stale_auto_publish_gate_reset'
    )
WHERE package_id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  AND step_key = 'auto_publish'
  AND status = 'blocked';

UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    last_error = NULL,
    updated_at = now()
WHERE id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  AND status = 'blocked';

-- 2. 772e30cf (Sozialversicherungsfachangestellter): integrity_passed=false
--    integrity report exists but is stale → re-run integrity check
UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    meta = meta || jsonb_build_object(
      'system_heal_at', now()::text,
      'system_heal_reason', 'stale_integrity_report_recheck'
    )
WHERE package_id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  AND step_key = 'run_integrity_check'
  AND status IN ('done', 'failed', 'blocked');

UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    meta = meta || jsonb_build_object(
      'system_heal_at', now()::text,
      'system_heal_reason', 'stale_auto_publish_gate_reset'
    )
WHERE package_id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  AND step_key = 'auto_publish'
  AND status = 'blocked';

UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    integrity_passed = false,
    last_error = NULL,
    updated_at = now()
WHERE id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  AND status = 'blocked';

-- 3. 9c1b3734 (Industriemechaniker): same pattern
UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    meta = meta || jsonb_build_object(
      'system_heal_at', now()::text,
      'system_heal_reason', 'stale_integrity_report_recheck'
    )
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key = 'run_integrity_check'
  AND status IN ('done', 'failed', 'blocked');

UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    meta = meta || jsonb_build_object(
      'system_heal_at', now()::text,
      'system_heal_reason', 'stale_auto_publish_gate_reset'
    )
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key = 'auto_publish'
  AND status = 'blocked';

UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    integrity_passed = false,
    last_error = NULL,
    updated_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND status = 'blocked';

-- 4. Clean up ALL 157 failed jobs → cancel stale ones
UPDATE job_queue
SET status = 'cancelled',
    last_error = coalesce(last_error, '') || ' | SYSTEM_CLEANUP:stale_failed_job_cancelled_' || now()::text
WHERE status = 'failed';

-- 5. Audit log
INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'system_wide_heal',
  'pipeline',
  jsonb_build_object(
    'reason', 'unblock_3_packages_clean_157_failed_jobs',
    'fd1d8192', 'reset_auto_publish_step',
    '772e30cf', 'reset_integrity_check+auto_publish',
    '9c1b3734', 'reset_integrity_check+auto_publish',
    'failed_jobs_cancelled', 157
  ),
  ARRAY['fd1d8192-a16f-496b-80c8-5e06f70ec21a', '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1', '9c1b3734-bb25-4986-baef-5bb1c20a212c']
);
