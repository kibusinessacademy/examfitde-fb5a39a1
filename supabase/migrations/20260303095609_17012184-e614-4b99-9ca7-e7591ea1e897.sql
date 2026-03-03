
-- Prevent duplicate active jobs per (package_id, job_type)
-- Only one pending/queued/processing job allowed at a time.
-- completed/cancelled/failed are excluded → history preserved.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_queue_active_package_job
ON public.job_queue (package_id, job_type)
WHERE status IN ('pending','queued','processing');
