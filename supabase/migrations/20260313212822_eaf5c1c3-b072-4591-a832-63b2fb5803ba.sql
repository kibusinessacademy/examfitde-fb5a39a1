
-- Fix: Cancel the infinite-loop minicheck job and let the fixed function take over
-- 1) Cancel the currently processing/pending minicheck job
UPDATE job_queue 
SET status = 'cancelled', 
    last_error = 'forensic-fix: cancelled infinite loop caused by 1000-row limit bug'
WHERE payload->>'package_id' = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND job_type = 'package_generate_lesson_minichecks'
  AND status IN ('pending', 'processing');

-- 2) Reset the step to queued so the fixed function gets dispatched fresh
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = 'forensic-fix: reset after 1000-row-limit infinite loop fix (11 of 160 lessons remaining)'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'generate_lesson_minichecks'
  AND status IN ('enqueued', 'running');
