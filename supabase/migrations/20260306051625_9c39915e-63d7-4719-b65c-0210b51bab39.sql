-- Reset all failed generate_learning_content steps so the pipeline picks them up again
-- Also reset the parent package status from quality_gate_failed/failed back to building

-- 1. Reset failed steps
UPDATE public.package_steps
SET
  status = 'queued',
  attempts = 0,
  last_error = NULL,
  started_at = NULL,
  finished_at = NULL,
  updated_at = now()
WHERE step_key = 'generate_learning_content'
  AND status = 'failed';

-- 2. Reset parent packages that were marked as failed due to these steps
UPDATE public.course_packages
SET
  status = 'building',
  updated_at = now()
WHERE status IN ('quality_gate_failed', 'failed')
  AND id IN (
    SELECT DISTINCT package_id
    FROM public.package_steps
    WHERE step_key = 'generate_learning_content'
      AND status = 'queued'
  );

-- 3. Clean up any failed/cancelled jobs for these packages to avoid idempotency conflicts
DELETE FROM public.job_queue
WHERE job_type = 'lesson_generate_content'
  AND status IN ('failed', 'cancelled')
  AND payload->>'package_id' IN (
    SELECT DISTINCT package_id::text
    FROM public.package_steps
    WHERE step_key = 'generate_learning_content'
      AND status = 'queued'
  );