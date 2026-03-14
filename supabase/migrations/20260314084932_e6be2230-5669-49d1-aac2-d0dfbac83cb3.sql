
-- 1. Kill the zombie auto_publish job AGAIN
UPDATE job_queue SET status = 'cancelled', last_error = 'Killed: autofix still running, must not publish yet', updated_at = now()
WHERE id = 'c3d3f62a-9cde-4221-8bd3-3402f92cc4ab' AND status = 'pending';

-- 2. Increase max_attempts on auto_gap_close so it can retry
UPDATE job_queue SET max_attempts = 8, updated_at = now()
WHERE id = '8cf78021-d0a1-495b-81b1-26207b350695' AND status = 'pending';

-- Audit
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES ('fix_gap_close_and_kill_publish', 'job_queue', 
  ARRAY['8cf78021-d0a1-495b-81b1-26207b350695','c3d3f62a-9cde-4221-8bd3-3402f92cc4ab'],
  '{"reason":"auto_publish revived by unknown trigger while autofix active. auto_gap_close had max_attempts=1, increased to 8."}'::jsonb);
