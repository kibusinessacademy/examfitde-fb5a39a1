-- Fix: uq_job_queue_active_package_job blocks lesson-level fan-out because all
-- lesson_generate_content jobs have learning_field_filter=NULL → all map to '__root__'.
-- Solution: add lesson_id as additional discriminator so N lesson jobs can coexist.
--
-- Before: (package_id, job_type, COALESCE(payload->>'learning_field_filter','__root__'))
-- After:  same + COALESCE(payload->>'lesson_id','__all__')
--         → lesson-level fan-out works, exam-pool LF fan-out still works

DROP INDEX IF EXISTS uq_job_queue_active_package_job;

CREATE UNIQUE INDEX uq_job_queue_active_package_job
  ON public.job_queue (
    package_id,
    job_type,
    COALESCE((payload->>'learning_field_filter'), '__root__'),
    COALESCE((payload->>'lesson_id'), '__all__')
  )
  WHERE status IN ('pending', 'queued', 'processing');