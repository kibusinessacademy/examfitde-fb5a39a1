
-- Refactor: Replace _fan_out partial indexes with clean scoped idempotency
-- Root jobs: learning_field_filter is null → coalesce to '__root__'
-- Fan-out jobs: learning_field_filter is set → unique per LF

-- 1) Drop all existing variants
DROP INDEX IF EXISTS uq_jobqueue_curriculum_jobtype_active;
DROP INDEX IF EXISTS uq_jobqueue_package_jobtype_active;
DROP INDEX IF EXISTS idx_job_queue_pipeline_idempotency;
DROP INDEX IF EXISTS uq_jobqueue_fanout_per_lf;

-- 2) Scoped curriculum idempotency
CREATE UNIQUE INDEX uq_jobqueue_curriculum_jobtype_scope_active
ON public.job_queue (
  job_type,
  (payload->>'curriculum_id'),
  coalesce(payload->>'learning_field_filter', '__root__')
)
WHERE status IN ('pending','processing')
  AND payload ? 'curriculum_id';

-- 3) Scoped package idempotency
CREATE UNIQUE INDEX uq_jobqueue_package_jobtype_scope_active
ON public.job_queue (
  job_type,
  (payload->>'package_id'),
  coalesce(payload->>'learning_field_filter', '__root__')
)
WHERE status IN ('pending','processing')
  AND payload ? 'package_id';

-- 4) Scoped pipeline idempotency
CREATE UNIQUE INDEX idx_job_queue_pipeline_idempotency_scope
ON public.job_queue (
  (payload->>'package_id'),
  job_type,
  coalesce(payload->>'learning_field_filter', '__root__')
)
WHERE status IN ('pending','processing');
