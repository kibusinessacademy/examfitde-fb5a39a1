
-- EMERGENCY v3: Cancel ALL active exam_pool jobs (root + sub-jobs)
-- This stops the infinite loop immediately
UPDATE job_queue 
SET status = 'cancelled', 
    updated_at = now(),
    locked_at = null,
    locked_by = null,
    last_error = 'EMERGENCY_CANCEL_v3: root-cause loop fix deployed — root jobs complete instantly, invisible to dedup guard'
WHERE job_type = 'package_generate_exam_pool'
AND status IN ('pending', 'processing', 'queued');

-- Also mark the steps as queued so they can be picked up AFTER the fix is deployed
-- but with a 10-minute delay to ensure the new code is active
UPDATE package_steps
SET status = 'queued',
    job_id = null,
    runner_id = null,
    started_at = null,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'retry_after_sec', 600,
      'loop_fix_applied', true,
      'loop_fix_at', now()::text
    )
WHERE step_key = 'generate_exam_pool'
AND status IN ('running', 'enqueued');
