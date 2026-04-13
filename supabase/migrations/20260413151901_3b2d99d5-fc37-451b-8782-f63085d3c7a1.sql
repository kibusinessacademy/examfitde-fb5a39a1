
-- Runner health heartbeat table
CREATE TABLE public.runner_health_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  runner_name TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  lanes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ok',
  passes INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  runtime_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups by runner + time
CREATE INDEX idx_runner_health_log_runner_time ON public.runner_health_log (runner_name, created_at DESC);

-- Cleanup: auto-delete entries older than 7 days (run via cron or manual)
COMMENT ON TABLE public.runner_health_log IS 'Runtime-level health heartbeats from each runner. Used for lane-alive alerting and dead-runner detection.';

-- View: latest health per runner
CREATE OR REPLACE VIEW public.v_runner_health_latest AS
SELECT DISTINCT ON (runner_name)
  runner_name,
  worker_id,
  lanes,
  status,
  passes,
  claimed,
  succeeded,
  failed,
  runtime_ms,
  error_message,
  created_at as last_seen_at,
  CASE 
    WHEN created_at < now() - interval '15 minutes' THEN 'dead'
    WHEN created_at < now() - interval '5 minutes' THEN 'stale'
    WHEN status = 'crash' THEN 'crash'
    ELSE 'alive'
  END as health_status,
  extract(epoch from (now() - created_at))::int as seconds_ago
FROM public.runner_health_log
ORDER BY runner_name, created_at DESC;
