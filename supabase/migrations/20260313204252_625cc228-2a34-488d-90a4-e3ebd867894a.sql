-- Fix Ghost-Done: validate_exam_pool was marked done by watchdog without actually validating
-- Reset to queued so the step re-runs and validates the 178 draft questions

-- 1) Reset validate_exam_pool step
UPDATE package_steps 
SET status = 'queued', 
    last_error = 'forensic-fix: ghost-done reset — 178 questions still draft/pending, watchdog timeout caused false-done'
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'::uuid
  AND step_key = 'validate_exam_pool'
  AND status = 'done';

-- 2) Also reset downstream steps that are stuck because of this
UPDATE package_steps 
SET status = 'queued',
    last_error = 'forensic-fix: reset due to upstream validate_exam_pool ghost-done'
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'::uuid
  AND step_key IN ('build_ai_tutor_index', 'validate_tutor_index', 'elite_harden')
  AND status = 'running';

-- 3) Cancel the stuck pending jobs that can't proceed
UPDATE job_queue 
SET status = 'cancelled', 
    last_error = 'forensic-fix: cancelled due to upstream ghost-done on validate_exam_pool'
WHERE payload->>'package_id' = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND status = 'pending'
  AND job_type IN ('package_build_ai_tutor_index', 'package_elite_harden');