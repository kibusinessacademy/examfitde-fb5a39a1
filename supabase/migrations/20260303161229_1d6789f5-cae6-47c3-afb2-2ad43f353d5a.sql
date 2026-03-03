-- Fix: uq_job_queue_active_package_job blocks fan-out sub-jobs because root job
-- (processing) has same (package_id, job_type). Adding learning_field_filter
-- discriminator allows fan-out sub-jobs to coexist with root job.
--
-- Before: (package_id, job_type) → only 1 active job per package+type
-- After:  (package_id, job_type, COALESCE(payload->>'learning_field_filter','__root__'))
--         → root + N per-LF sub-jobs can coexist

DROP INDEX IF EXISTS uq_job_queue_active_package_job;

CREATE UNIQUE INDEX uq_job_queue_active_package_job
  ON public.job_queue (
    package_id,
    job_type,
    COALESCE((payload->>'learning_field_filter'), '__root__')
  )
  WHERE status IN ('pending', 'queued', 'processing');