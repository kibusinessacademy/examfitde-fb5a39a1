
-- 1. Block Büromanagement (5377ab93) and cancel all its looping jobs
UPDATE course_packages 
SET status = 'blocked',
    blocked_reason = 'kill_switch: validate_exam_pool failed after 7+ heal cycles — manual reseed required',
    last_error = 'Kill-switch: validate_exam_pool exhausted 7 heal cycles. 175 unresolved QC flags.'
WHERE id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND status = 'building';

-- Mark the validate_exam_pool step as terminally failed
UPDATE package_steps 
SET status = 'failed',
    attempts = 99,
    meta = COALESCE(meta, '{}'::jsonb) || '{"terminal_escalation": true, "kill_switch_at": "2026-03-14T06:00:00Z"}'::jsonb,
    last_error = 'Kill-switch: 7 heal cycles exhausted. 175 unresolved QC flags, 8 missing LF coverage.'
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND step_key = 'validate_exam_pool';

-- Cancel all pending/processing jobs for Büromanagement
UPDATE job_queue 
SET status = 'cancelled',
    last_error = 'kill_switch: package blocked after heal cycle exhaustion',
    completed_at = now()
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND status IN ('pending', 'processing');

-- 2. Cancel looping zero-generation jobs for Elektroniker (fd1d8192)
UPDATE job_queue 
SET status = 'cancelled',
    last_error = 'zero_gen_loop_fix: cancelled to break dispatch loop',
    completed_at = now()
WHERE package_id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  AND status IN ('pending', 'processing')
  AND job_type IN ('package_generate_exam_pool', 'package_generate_lesson_minichecks');
