
-- 1. Stop the infinite requeue loop: kill the publish job
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'Cancelled: integrity_passed=false (score=62, 6 hard fails). Gap-close needed before publish.',
    updated_at = now()
WHERE id = '5ba9cdb3-ad01-4b24-b035-cc2d4abc0539'
  AND status = 'pending';

-- 2. Reset auto_publish step back to queued (will be re-enqueued after gap-close)
UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key = 'auto_publish';

-- 3. Also reset quality_council to queued so it re-runs after gap-close
UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key = 'quality_council';

-- 4. Reset run_integrity_check so it re-evaluates after new content
UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key = 'run_integrity_check';

-- 5. Reset integrity_passed flag
UPDATE course_packages
SET integrity_passed = false,
    updated_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c';

-- AUDIT
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'stop_publish_loop_trigger_gap_close',
  'job_queue + package_steps + course_packages',
  ARRAY['9c1b3734-bb25-4986-baef-5bb1c20a212c', '5ba9cdb3-ad01-4b24-b035-cc2d4abc0539'],
  '{"reason": "Publish loop: job was requeued every 5min by AUTO_PUBLISH_GATE (integrity_passed=false, score=62). Cancelled job, reset integrity/quality/publish steps to queued. Triggering auto-gap-close next.", "hard_fails": ["EXAM_POOL: 113/500 approved", "HARDISH_TOO_LOW: 30.1%", "BLOOM_GATE: 2 levels", "ELITE_CONTEXT: 30.1%", "COMPETENCY_COVERAGE: 13/48", "MINICHECK_UNPARSED: 2"]}'::jsonb
);
