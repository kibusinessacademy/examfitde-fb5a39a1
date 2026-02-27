
-- Allow parallel enrichment jobs per curriculum (instead of 1 global)
DROP INDEX IF EXISTS job_queue_unique_global_job;

CREATE UNIQUE INDEX job_queue_unique_global_job 
ON public.job_queue (job_type, COALESCE(payload->>'curriculum_id', ''))
WHERE status IN ('pending', 'processing') AND package_id IS NULL;
