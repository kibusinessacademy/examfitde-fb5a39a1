
-- Reset tier1_failed questions for Büromanagement to pending for re-validation with fixed validator
UPDATE exam_questions
SET qc_status = 'pending'
WHERE curriculum_id = '33eb7832-8c80-46fa-a3ad-a9a5ee996e87'
AND qc_status = 'tier1_failed';

-- Cancel all pending/failed validate_exam_pool jobs to stop the loop
UPDATE job_queue
SET status = 'cancelled', error = 'cancelled: validator fix deployed'
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
AND job_type = 'package_validate_exam_pool'
AND status IN ('pending', 'failed');

-- Reset the step to queued for a fresh run
UPDATE package_steps
SET status = 'queued', started_at = NULL, finished_at = NULL, last_error = NULL,
    meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{attempts}', '0')
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
AND step_key = 'validate_exam_pool';
