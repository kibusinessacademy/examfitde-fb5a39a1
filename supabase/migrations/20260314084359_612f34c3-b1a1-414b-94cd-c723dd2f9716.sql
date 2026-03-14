
-- Unblock Industriemechaniker: set back to building so OPS_GUARD allows jobs
UPDATE course_packages
SET status = 'building',
    integrity_passed = false,
    updated_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND status = 'quality_gate_failed';

-- Reset the run_integrity_check step back to queued (will be re-run after gap-close)
UPDATE package_steps
SET status = 'queued', last_error = NULL, updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key = 'run_integrity_check';

-- Revive the failed auto_gap_close job  
UPDATE job_queue
SET status = 'pending',
    attempts = 0,
    last_error = NULL,
    error = NULL,
    run_after = now(),
    updated_at = now()
WHERE id = '8cf78021-d0a1-495b-81b1-26207b350695'
  AND status = 'failed';

-- Audit
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'unblock_autofix_deadlock',
  'course_packages + package_steps + job_queue',
  ARRAY['9c1b3734-bb25-4986-baef-5bb1c20a212c', '8cf78021-d0a1-495b-81b1-26207b350695'],
  '{"reason": "integrity_check set quality_gate_failed while autofix_run was still active (round 2). OPS_GUARD killed auto_gap_close. Structural fix: integrity-check now checks for active autofix runs before setting quality_gate_failed."}'::jsonb
);
