-- Deduplicate active lesson-level generation jobs
-- Prevents job storms when dispatcher + watchdog + runner all try to enqueue simultaneously
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_queue_active_lesson_step
ON public.job_queue (
  job_type,
  (payload->>'package_id'),
  (payload->>'lesson_id'),
  (payload->>'step_key')
)
WHERE status IN ('pending','queued','processing')
  AND payload->>'lesson_id' IS NOT NULL;