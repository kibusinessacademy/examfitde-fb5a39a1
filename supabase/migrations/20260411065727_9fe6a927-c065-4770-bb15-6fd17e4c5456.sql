
-- Fix: unique constraint references legacy camelCase 'blueprintId' but payloads now use 'blueprint_id'
DROP INDEX IF EXISTS uq_job_queue_active_package_job;

CREATE UNIQUE INDEX uq_job_queue_active_package_job
  ON public.job_queue (
    package_id,
    job_type,
    COALESCE(payload->>'learning_field_filter', '__root__'),
    COALESCE(payload->>'lesson_id', '__all__'),
    COALESCE(payload->>'blueprint_id', '__all__')
  )
  WHERE status IN ('pending', 'queued', 'processing');
