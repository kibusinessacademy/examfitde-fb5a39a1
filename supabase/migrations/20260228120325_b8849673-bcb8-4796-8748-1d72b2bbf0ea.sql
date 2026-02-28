-- Remove broad package-level active uniqueness that blocks LF fan-out jobs.
-- Scoped uniqueness is already enforced by:
--   uq_jobqueue_package_jobtype_scope_active
--   idx_job_queue_pipeline_idempotency_scope
-- (job_type + package_id + learning_field_filter, active statuses)
DROP INDEX IF EXISTS public.job_queue_unique_active_job;