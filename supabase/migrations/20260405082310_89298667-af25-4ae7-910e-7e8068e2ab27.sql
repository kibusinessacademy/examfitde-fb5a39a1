
-- Fix 1: Reset the falsely-permanent-failed validate_lesson_minichecks job
UPDATE public.job_queue 
SET status = 'pending', 
    attempts = 0, 
    last_error = 'RESET: was falsely permanent-failed at 73% coverage (contract bug fixed in v4)',
    locked_at = NULL, 
    locked_by = NULL,
    completed_at = NULL,
    started_at = NULL,
    run_after = NULL,
    updated_at = now()
WHERE id = '8fdfc6bb-0494-463b-8cf1-c08847d1d8f1';

-- Fix 2: Reset the step back to queued
UPDATE public.package_steps
SET status = 'queued',
    last_error = NULL,
    updated_at = now()
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND step_key = 'validate_lesson_minichecks'
  AND status = 'failed';

-- Fix 3: Check for OTHER jobs falsely permanently failed with 0 attempts
-- and GATE_FAIL pattern (same contract bug in other packages)
UPDATE public.job_queue
SET status = 'pending',
    attempts = 0,
    last_error = 'RESET: was falsely permanent-failed with 0 attempts (contract bug fixed in v4)',
    locked_at = NULL,
    locked_by = NULL,
    completed_at = NULL,
    started_at = NULL,
    run_after = NULL,
    updated_at = now()
WHERE status = 'failed'
  AND attempts = 0
  AND last_error LIKE 'GATE_FAIL:%'
  AND job_type LIKE 'package_validate_%';
