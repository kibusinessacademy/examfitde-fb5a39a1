
-- Terminate stalled autofix_run fab40d70 (round 5 > max_rounds 3, score frozen at 59)
UPDATE autofix_runs
SET status = 'failed',
    stop_reason = 'STAGNATION: score frozen at 59 after 5 rounds (max_rounds=3)'
WHERE id = 'fab40d70-9d0e-445b-a935-3a0e00843e30'
  AND status = 'running';

-- Cancel the infinite-looping publish job  
UPDATE job_queue
SET status = 'cancelled',
    completed_at = now(),
    last_error = 'AUTO_PUBLISH_BLOCKED: autofix stalled after 5 rounds, score=59'
WHERE id = 'f7ae1fd3-b5a6-4f74-893d-e8ca1f4e3d05'
  AND status = 'pending';

-- Set package to quality_gate_failed for ops visibility
UPDATE course_packages
SET status = 'quality_gate_failed'
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND status = 'building';
