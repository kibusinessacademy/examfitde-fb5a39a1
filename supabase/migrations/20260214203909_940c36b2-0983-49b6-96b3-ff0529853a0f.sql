
-- ============================================================
-- Runner ↔ Worker Marriage: Step enqueue tracking
-- ============================================================

-- 1) Add 'enqueued' to step_status enum
ALTER TYPE public.step_status ADD VALUE IF NOT EXISTS 'enqueued' AFTER 'queued';

-- 2) Add job_id to package_steps for tracking the worker job
ALTER TABLE public.package_steps 
ADD COLUMN IF NOT EXISTS job_id uuid;

-- 3) Add idempotency: unique constraint on (package_id, step_key) in job_queue
-- We use a partial unique index on active jobs to prevent double-enqueue
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_queue_pipeline_idempotency
ON public.job_queue (
  (payload->>'package_id'), 
  job_type
)
WHERE status IN ('pending', 'processing');

-- 4) Index for fast job_id lookup from package_steps
CREATE INDEX IF NOT EXISTS idx_package_steps_job_id 
ON public.package_steps (job_id) 
WHERE job_id IS NOT NULL;
