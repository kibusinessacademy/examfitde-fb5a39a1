-- Add completion_rate and claim_rate columns to runner_health_log
ALTER TABLE public.runner_health_log 
  ADD COLUMN IF NOT EXISTS completion_rate numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS claim_rate numeric DEFAULT NULL;

-- Recreate the view with new columns
DROP VIEW IF EXISTS public.v_runner_health_latest;
CREATE OR REPLACE VIEW public.v_runner_health_latest AS
SELECT DISTINCT ON (runner_name)
  runner_name,
  worker_id,
  lanes,
  status AS health_status,
  EXTRACT(EPOCH FROM (now() - created_at))::int AS seconds_ago,
  passes,
  claimed,
  succeeded,
  failed,
  runtime_ms,
  error_message,
  completion_rate,
  claim_rate,
  created_at
FROM public.runner_health_log
ORDER BY runner_name, created_at DESC;