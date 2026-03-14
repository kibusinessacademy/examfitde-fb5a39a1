
-- HEAL: Kill zombie autofix_run for Mechatroniker (all its jobs were OPS_GUARD-killed)
UPDATE autofix_runs
SET status = 'failed',
    stop_reason = 'Zombie: jobs killed by OPS_GUARD before fix — reset for retry',
    updated_at = now()
WHERE id = '45c78aec-54ff-45c4-b30a-c9c241a2b7b2'
  AND status = 'running';

-- HEAL: Clear OPS_GUARD error from auto_publish step
UPDATE package_steps
SET last_error = NULL
WHERE package_id = '2e8da39f-60f8-44d9-8b70-e1176222ca55'
  AND step_key = 'auto_publish'
  AND last_error ILIKE '%OPS_GUARD%';

-- AUDIT
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'heal_mechatroniker_zombie_autofix',
  'autofix_runs + package_steps',
  ARRAY['2e8da39f-60f8-44d9-8b70-e1176222ca55', '45c78aec-54ff-45c4-b30a-c9c241a2b7b2'],
  '{"reason": "Zombie autofix_run blocked new gap-close attempts. OPS_GUARD error cleared from auto_publish."}'::jsonb
);
