
-- 1. Cancel broken drift_reconcile validate jobs
UPDATE job_queue
SET status = 'cancelled', 
    last_error = 'cancelled: drift_reconcile premature - finalize not done yet'
WHERE meta->>'trigger' = 'drift_reconcile'
  AND job_type = 'package_validate_learning_content'
  AND status IN ('pending', 'failed', 'queued');

-- 2. Cancel exhausted (failed, max attempts) finalize jobs to allow fresh re-enqueue
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'cancelled: reset for hotfix re-enqueue'
WHERE job_type = 'package_finalize_learning_content'
  AND status = 'failed'
  AND attempts >= max_attempts;

-- 3. Enqueue fresh finalize jobs for all building packages where finalize is NOT done
INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, max_attempts)
SELECT 
  'package_finalize_learning_content',
  cp.id,
  'pending',
  cp.priority,
  jsonb_build_object(
    'package_id', cp.id,
    'course_id', cp.course_id,
    'curriculum_id', cp.curriculum_id
  ),
  jsonb_build_object('trigger', 'hotfix_finalize_wave', 'created_at', NOW()::text),
  20
FROM course_packages cp
JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key = 'finalize_learning_content'
WHERE cp.status = 'building'
  AND ps.status NOT IN ('done', 'running')
  AND NOT EXISTS (
    SELECT 1 FROM job_queue jq
    WHERE jq.package_id = cp.id
      AND jq.job_type = 'package_finalize_learning_content'
      AND jq.status IN ('pending', 'queued')
  );

-- 4. Reset finalize step status to 'queued' for packages stuck in 'enqueued' or 'running'
UPDATE package_steps
SET status = 'queued', updated_at = NOW()
WHERE step_key = 'finalize_learning_content'
  AND status IN ('enqueued', 'running')
  AND package_id IN (SELECT id FROM course_packages WHERE status = 'building');

-- 5. Audit log
INSERT INTO admin_actions (action, scope, payload)
VALUES (
  'hotfix_finalize_wave',
  'pipeline_recovery',
  jsonb_build_object(
    'reason', 'totalShards ReferenceError fix + finalize re-enqueue for all stalled building packages',
    'actions', ARRAY['cancel_drift_reconcile_jobs', 'cancel_exhausted_finalize', 'enqueue_fresh_finalize', 'reset_stuck_steps']
  )
);
