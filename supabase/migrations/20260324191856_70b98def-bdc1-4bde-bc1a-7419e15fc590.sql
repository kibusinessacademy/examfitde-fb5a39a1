-- SoVFa Deadlock-Auflösung Round 5: break QG-heal circular dependency
-- 2021 pending questions exist but validator never runs because healer keeps resetting prereq

-- 1. Set generate_exam_pool to done with proper timestamps + reset heal_cycles
UPDATE package_steps
SET status = 'done',
    started_at = '2026-03-24T17:00:00Z',
    finished_at = '2026-03-24T18:00:00Z',
    last_error = NULL,
    meta = jsonb_build_object(
      'note', 'full_reset_v1',
      'reconciled', 'deadlock_break_r5',
      'reconciled_at', now()::text,
      'heal_cycles', 0,
      'deadlock_break_reason', 'QG-heal circular dependency: 2021 pending questions exist but validator never runs because healer keeps resetting prereq'
    )
WHERE package_id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  AND step_key = 'generate_exam_pool'
  AND status = 'queued';

-- 2. Clean validate_exam_pool step for fresh dispatch
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL,
    meta = jsonb_build_object(
      'note', 'deadlock_break_r5',
      'reconciled_at', now()::text,
      'heal_cycles', 0
    )
WHERE package_id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  AND step_key = 'validate_exam_pool';

-- 3. Cancel stale validate jobs carrying old error context
UPDATE job_queue
SET status = 'cancelled',
    error = 'deadlock_break_r5: replaced by clean dispatch'
WHERE package_id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  AND job_type = 'package_validate_exam_pool'
  AND status = 'pending';