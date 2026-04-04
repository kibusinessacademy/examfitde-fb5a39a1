-- F-1: Extend unique index with blueprintId discriminator
DROP INDEX IF EXISTS uq_job_queue_active_package_job;

CREATE UNIQUE INDEX uq_job_queue_active_package_job
ON job_queue (
  package_id,
  job_type,
  COALESCE(payload->>'learning_field_filter', '__root__'),
  COALESCE(payload->>'lesson_id', '__all__'),
  COALESCE(payload->>'blueprintId', '__all__')
)
WHERE status IN ('pending','queued','processing');