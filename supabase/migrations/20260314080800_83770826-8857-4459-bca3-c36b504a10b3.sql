
-- HEAL: Reset stuck autofix_run 918b793d (zombie - all jobs failed by OPS_GUARD)
UPDATE autofix_runs
SET status = 'failed',
    stop_reason = 'All jobs killed by OPS_GUARD:NON_BUILDING_PACKAGE — bug fixed in auto-gap-close deploy',
    updated_at = now()
WHERE id = '918b793d-587e-4758-81e0-eacb57acfdcd'
  AND status = 'running';

-- HEAL: Reset package 9c1b3734 to building so auto-gap-close can work
UPDATE course_packages
SET status = 'building',
    updated_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND status = 'quality_gate_failed';

-- HEAL: Reset auto_publish step (it has stale OPS_GUARD error)
UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    started_at = NULL,
    finished_at = NULL
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key = 'auto_publish'
  AND last_error ILIKE '%OPS_GUARD%';

-- AUDIT: Log the heal action
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'heal_auto_gap_close_deadlock',
  'course_packages + autofix_runs',
  ARRAY['9c1b3734-bb25-4986-baef-5bb1c20a212c', '918b793d-587e-4758-81e0-eacb57acfdcd'],
  '{"reason": "Auto-gap-close enqueued jobs but OPS_GUARD killed them because package was quality_gate_failed, not building. Fixed edge function to transition status before enqueue."}'::jsonb
);
