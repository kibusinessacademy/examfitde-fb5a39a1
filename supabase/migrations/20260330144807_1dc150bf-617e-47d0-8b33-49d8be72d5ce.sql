
-- Unblock the Industriemechaniker package: reset to building so the pipeline can process it
-- This is safe because the repair function + integrity check will re-evaluate
UPDATE course_packages 
SET status = 'building', 
    blocked_reason = NULL,
    updated_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND status = 'blocked';

-- Reset the failed steps back to queued
UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    started_at = NULL,
    finished_at = NULL,
    updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND step_key IN ('run_integrity_check', 'auto_publish', 'repair_exam_pool_quality', 'validate_exam_pool')
  AND status IN ('failed', 'queued');

-- Enqueue a targeted repair job for this package
INSERT INTO job_queue (job_type, package_id, status, priority, payload)
VALUES (
  'package_repair_exam_pool_quality',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  'pending',
  20,
  jsonb_build_object(
    'package_id', '9c1b3734-bb25-4986-baef-5bb1c20a212c',
    'curriculum_id', '2c01d31e-e7ed-4b82-b04e-d5094d1dc179',
    'triggered_by', 'manual_unblock_after_fix'
  )
);
