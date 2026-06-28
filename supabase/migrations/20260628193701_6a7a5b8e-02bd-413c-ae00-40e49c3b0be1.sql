
-- Fix #2: Composite index for the hot PostgREST poll path on auto_heal_log
CREATE INDEX IF NOT EXISTS idx_auto_heal_log_action_target_status_created
  ON public.auto_heal_log (action_type, target_id, result_status, created_at DESC);

-- Fix #3: Throttle the heaviest drift detector (mean 18s, max 119s, ran every 5min)
SELECT cron.alter_job(
  job_id   := 147,
  schedule := '*/30 * * * *'
);
