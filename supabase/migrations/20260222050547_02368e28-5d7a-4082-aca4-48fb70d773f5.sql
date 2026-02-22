-- Fix: Allow fan-out sub-jobs (payload._fan_out = true) to coexist
-- by excluding them from the idempotency constraints.
-- Non-fan-out jobs still get full protection.

-- 1) Drop and recreate uq_jobqueue_curriculum_jobtype_active
DROP INDEX IF EXISTS uq_jobqueue_curriculum_jobtype_active;
CREATE UNIQUE INDEX uq_jobqueue_curriculum_jobtype_active
ON public.job_queue (
  job_type,
  (payload->>'curriculum_id')
)
WHERE status IN ('pending','processing')
  AND payload ? 'curriculum_id'
  AND NOT coalesce((payload->>'_fan_out')::boolean, false);

-- 2) Drop and recreate uq_jobqueue_package_jobtype_active
DROP INDEX IF EXISTS uq_jobqueue_package_jobtype_active;
CREATE UNIQUE INDEX uq_jobqueue_package_jobtype_active
ON public.job_queue (
  job_type,
  (payload->>'package_id')
)
WHERE status IN ('pending','processing')
  AND payload ? 'package_id'
  AND NOT coalesce((payload->>'_fan_out')::boolean, false);

-- 3) Drop and recreate idx_job_queue_pipeline_idempotency
DROP INDEX IF EXISTS idx_job_queue_pipeline_idempotency;
CREATE UNIQUE INDEX idx_job_queue_pipeline_idempotency
ON public.job_queue (
  (payload->>'package_id'),
  job_type
)
WHERE status IN ('pending','processing')
  AND NOT coalesce((payload->>'_fan_out')::boolean, false);

-- 4) New: fan-out idempotency per (package_id, job_type, learning_field_filter)
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobqueue_fanout_per_lf
ON public.job_queue (
  job_type,
  (payload->>'package_id'),
  (payload->>'learning_field_filter')
)
WHERE status IN ('pending','processing')
  AND coalesce((payload->>'_fan_out')::boolean, false) = true;