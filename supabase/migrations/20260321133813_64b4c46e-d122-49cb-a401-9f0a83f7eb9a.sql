
-- ═══════════════════════════════════════════════════════════════
-- Autofix: Industriekaufmann/-frau — Unblock + restart content gen
-- Package: f5e3403b-1fc6-46b3-a275-8420287f351e
-- ═══════════════════════════════════════════════════════════════

-- 1. Unblock package → building
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    stuck_reason = NULL,
    updated_at = now()
WHERE id = 'f5e3403b-1fc6-46b3-a275-8420287f351e'
  AND status = 'blocked';

-- 2. Cancel all failed/stuck jobs to clear noise
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'Autofix: cleared for restart',
    completed_at = now()
WHERE package_id = 'f5e3403b-1fc6-46b3-a275-8420287f351e'
  AND status IN ('failed', 'stuck');

-- 3. Reset content generation steps to queued with 0 attempts
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    last_error = NULL,
    started_at = NULL,
    finished_at = NULL,
    updated_at = now()
WHERE package_id = 'f5e3403b-1fc6-46b3-a275-8420287f351e'
  AND step_key IN (
    'generate_learning_content',
    'fanout_learning_content',
    'finalize_learning_content',
    'validate_learning_content',
    'generate_lesson_minichecks',
    'validate_lesson_minichecks',
    'generate_exam_pool',
    'generate_handbook',
    'generate_oral_exam',
    'run_integrity_check',
    'auto_publish'
  )
  AND status != 'done';

-- 4. Clear any loop guard metadata
UPDATE package_steps
SET meta = meta - 'loop_guard_blocked' - 'loop_guard_reason' - 'loop_guard_at'
WHERE package_id = 'f5e3403b-1fc6-46b3-a275-8420287f351e'
  AND meta IS NOT NULL
  AND (meta ? 'loop_guard_blocked' OR meta ? 'loop_guard_reason');

-- 5. Audit trail
INSERT INTO admin_actions (action, payload, affected_ids, scope)
VALUES (
  'autofix_unblock_industriekaufmann',
  '{"reason":"Package blocked by auto_heal_zombie (HARD_STALLED). 40 empty lessons. Unblocked, failed jobs cancelled, content gen steps reset for restart.","root_cause":"generate_learning_content never completed"}'::jsonb,
  ARRAY['f5e3403b-1fc6-46b3-a275-8420287f351e'],
  'autofix'
);
