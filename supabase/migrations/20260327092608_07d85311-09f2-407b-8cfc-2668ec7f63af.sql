
-- HEAL: Industriemechaniker (9c1b3734) — stale integrity report

-- 1. Reset run_integrity_check step
UPDATE package_steps 
SET status = 'queued', 
    last_error = 'HEAL: stale integrity report — all 240 minichecks now parsed',
    started_at = NULL, finished_at = NULL, updated_at = now(),
    job_id = NULL, runner_id = NULL
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c' 
  AND step_key = 'run_integrity_check';

-- 2. Reset auto_publish step
UPDATE package_steps 
SET status = 'queued',
    last_error = 'HEAL: reset pending integrity re-check',
    started_at = NULL, finished_at = NULL, updated_at = now(),
    job_id = NULL, runner_id = NULL
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c' 
  AND step_key = 'auto_publish';

-- 3. Unblock package
UPDATE course_packages 
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND status = 'blocked';

-- 4. Invalidate stale integrity report
UPDATE course_packages 
SET integrity_passed = false,
    integrity_report = NULL,
    updated_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c';

-- 5. Enqueue integrity check job with required curriculum_id
INSERT INTO job_queue (job_type, package_id, status, priority, payload, created_at, updated_at)
VALUES ('package_run_integrity_check', '9c1b3734-bb25-4986-baef-5bb1c20a212c', 'pending', 15, 
  '{"reason":"heal_stale_integrity_report","curriculum_id":"2c01d31e-e7ed-4b82-b04e-d5094d1dc179"}'::jsonb, 
  now(), now());

-- 6. Cancel orphan failed auto_publish jobs for published package
UPDATE job_queue 
SET status = 'cancelled', 
    last_error = 'HEAL: orphan job — package already published',
    completed_at = now(), updated_at = now()
WHERE package_id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  AND status = 'failed'
  AND job_type = 'package_auto_publish';

-- 7. Cancel stale failed integrity jobs
UPDATE job_queue 
SET status = 'cancelled',
    last_error = 'HEAL: premature integrity check — package still building',
    completed_at = now(), updated_at = now()
WHERE status = 'failed'
  AND job_type = 'package_run_integrity_check'
  AND last_error LIKE '%INTEGRITY_REPORT_MISSING%';

-- 8. Audit trail
INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
VALUES 
  ('heal_stale_integrity_report', 'manual_forensic', 'package', '9c1b3734-bb25-4986-baef-5bb1c20a212c', 'healed',
   'Stale integrity report: all 240 minichecks parsed but report flags 2 empty. Reset integrity + auto_publish, unblocked.',
   '{"minicheck_total": 240, "minicheck_parsed": 240, "original_blocker": "minicheck_parsed"}'::jsonb),
  ('cancel_orphan_jobs', 'manual_forensic', 'job_queue', null, 'healed',
   'Cancelled orphan auto_publish + stale integrity jobs', '{}'::jsonb);
