-- Unblock MFA: reset to building, clear block, reset pipeline tail
UPDATE course_packages 
SET status = 'building',
    blocked_reason = NULL,
    stuck_reason = NULL,
    integrity_passed = false,
    integrity_report = NULL
WHERE id = '11b697be-07a8-4164-ab1b-a8747ec49b03';

-- Reset pipeline tail steps
UPDATE package_steps 
SET status = 'queued',
    meta = meta - 'loop_guard_blocked_at' - 'loop_guard_count'
WHERE package_id = '11b697be-07a8-4164-ab1b-a8747ec49b03'
AND step_key IN ('run_integrity_check', 'auto_publish', 'elite_harden', 'quality_council')
AND status IN ('blocked', 'done');