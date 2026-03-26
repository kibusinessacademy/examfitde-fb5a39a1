
-- ============================================================
-- System-wide heal: 3 blocked packages + 1 failed job
-- ============================================================

-- 1. Elektroniker Betriebstechnik: ALL steps done, integrity+council passed
--    Root cause: stale QG_HEAL_EXHAUSTED blockade
--    Fix: unblock → published (auto_publish step already done)
UPDATE course_packages
SET status = 'published',
    blocked_reason = NULL,
    last_error = NULL,
    stuck_reason = NULL,
    updated_at = now()
WHERE id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  AND status = 'blocked';

-- 2. Industriemechaniker + SoVFa: easy% now at 17.0% (within limit)
--    Root cause: integrity_passed=false from pre-rebalance check, auto_publish blocked
--    Fix: re-run integrity check with corrected difficulty distribution
UPDATE package_steps
SET status = 'queued', last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'system_heal_at', now()::text,
      'system_heal_reason', 'rerun_after_difficulty_rebalance'
    )
WHERE package_id IN ('9c1b3734-bb25-4986-baef-5bb1c20a212c', '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1')
  AND step_key IN ('run_integrity_check', 'auto_publish')
  AND status IN ('done', 'failed', 'blocked');

UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    last_error = NULL,
    stuck_reason = NULL,
    integrity_passed = false,
    updated_at = now()
WHERE id IN ('9c1b3734-bb25-4986-baef-5bb1c20a212c', '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1')
  AND status = 'blocked';

-- 3. Cancel the 1 failed lesson_regen_repair job (unknown job type)
UPDATE job_queue SET status = 'cancelled',
  last_error = jsonb_build_object('cancelled_reason', 'UNKNOWN_JOB_TYPE not supported by runner')
WHERE job_type = 'lesson_regen_repair' AND status = 'failed';

-- 4. Audit
INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'system_heal_round3',
  'pipeline',
  jsonb_build_object(
    'elektroniker', 'stale QG_HEAL_EXHAUSTED → published (all gates passed)',
    'industriemechaniker', 'integrity rerun after easy% rebalance to 17.0%',
    'sozialversicherung', 'integrity rerun after easy% rebalance to 17.0%',
    'failed_jobs', '1 lesson_regen_repair cancelled (unsupported job type)'
  ),
  ARRAY['fd1d8192-a16f-496b-80c8-5e06f70ec21a','9c1b3734-bb25-4986-baef-5bb1c20a212c','772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1']
);
