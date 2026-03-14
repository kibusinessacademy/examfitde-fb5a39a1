-- 1. BÜROMANAGEMENT: Unblock + reset validate_exam_pool for 175 draft questions
UPDATE course_packages 
SET status = 'building',
    blocked_reason = NULL,
    last_error = NULL
WHERE id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND status = 'blocked';

UPDATE package_steps 
SET status = 'queued',
    attempts = 0,
    job_id = NULL,
    last_error = 'manual_reseed: 175 draft questions need validation',
    meta = jsonb_build_object('unblocked_at', now()::text)
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND step_key = 'validate_exam_pool';

-- Also reset downstream steps that depend on validate_exam_pool
UPDATE package_steps
SET status = 'queued', attempts = 0, job_id = NULL,
    last_error = 'cascade_reset: after validate_exam_pool unblock'
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND step_key IN ('elite_harden','generate_oral_exam','validate_oral_exam',
                   'build_ai_tutor_index','validate_tutor_index',
                   'run_integrity_check','quality_council','auto_publish')
  AND status NOT IN ('done');

-- 2. UNBLOCK ALL 31 auto_heal_zombie packages back to building
UPDATE course_packages 
SET status = 'building',
    blocked_reason = NULL,
    last_error = NULL
WHERE status = 'blocked'
  AND blocked_reason = 'auto_heal_zombie';

-- 3. UNBLOCK Bankkaufmann (FAILED_HEAL_EXHAUSTED)
UPDATE course_packages 
SET status = 'building',
    blocked_reason = NULL,
    last_error = NULL
WHERE status = 'blocked'
  AND blocked_reason LIKE 'FAILED_HEAL_EXHAUSTED%';

-- 4. Clear terminal_escalation flags on steps that were zombie-blocked prematurely
UPDATE package_steps ps
SET meta = meta - 'terminal_escalation'
WHERE EXISTS (
  SELECT 1 FROM course_packages cp 
  WHERE cp.id = ps.package_id AND cp.status = 'building'
)
AND (ps.meta->>'terminal_escalation')::boolean = true
AND ps.attempts < 3