-- Drop existing view to recreate with new columns
DROP VIEW IF EXISTS public.pipeline_deadlock_detection;

-- Phase 4A: Artifact-blocked jobs view (admin visibility)
CREATE OR REPLACE VIEW public.pipeline_artifact_blocked AS
SELECT
  jq.id AS job_id,
  jq.job_type,
  jq.package_id,
  (jq.meta->>'blocked_by_artifact')::text AS blocked_by_artifact,
  (jq.meta->>'blocked_by_producer')::text AS blocked_by_producer,
  (jq.meta->>'artifact_block_count')::int AS block_count,
  (jq.meta->>'artifact_storm')::boolean AS is_storm,
  (jq.meta->>'last_artifact_check')::timestamptz AS last_check_at,
  jq.run_after,
  jq.updated_at
FROM job_queue jq
WHERE jq.status = 'pending'
  AND (jq.meta->>'artifact_blocked')::boolean = true
ORDER BY (jq.meta->>'artifact_block_count')::int DESC NULLS LAST, jq.updated_at DESC;

-- Phase 4B: Enhanced deadlock detection — packages with ALL steps stuck
CREATE VIEW public.pipeline_deadlock_detection AS
SELECT
  ps.package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  count(*) AS total_steps,
  count(*) FILTER (WHERE ps.status IN ('blocked', 'failed')) AS stuck_steps,
  count(*) FILTER (WHERE ps.status = 'done') AS done_steps,
  count(*) FILTER (WHERE ps.status IN ('running', 'enqueued', 'queued')) AS active_steps,
  max(ps.updated_at) AS last_step_update,
  EXTRACT(EPOCH FROM (now() - max(ps.updated_at))) / 60.0 AS no_progress_minutes,
  CASE
    WHEN count(*) FILTER (WHERE ps.status IN ('running', 'enqueued', 'queued', 'done')) = 0
      AND count(*) FILTER (WHERE ps.status IN ('blocked', 'failed')) > 0
    THEN 'full_deadlock'
    WHEN EXTRACT(EPOCH FROM (now() - max(ps.updated_at))) / 60.0 > 60
    THEN 'stalled_60min'
    WHEN EXTRACT(EPOCH FROM (now() - max(ps.updated_at))) / 60.0 > 30
    THEN 'stalled_30min'
    ELSE 'active'
  END AS deadlock_status
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
WHERE cp.status = 'building'
GROUP BY ps.package_id, cp.title, cp.status
HAVING
  count(*) FILTER (WHERE ps.status IN ('running', 'enqueued', 'queued')) = 0
  OR EXTRACT(EPOCH FROM (now() - max(ps.updated_at))) / 60.0 > 30
ORDER BY no_progress_minutes DESC NULLS LAST;

-- Phase 5: Step execution metrics for self-tuning concurrency
CREATE TABLE IF NOT EXISTS public.step_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  step_key text NOT NULL,
  job_type text NOT NULL,
  duration_ms integer NOT NULL,
  success boolean NOT NULL DEFAULT true,
  worker_pool text DEFAULT 'core',
  error_category text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_step_metrics_step_key_created
  ON public.step_metrics (step_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_step_metrics_pool_created
  ON public.step_metrics (worker_pool, created_at DESC);

-- Phase 5B: Aggregated step performance view
CREATE OR REPLACE VIEW public.step_performance_stats AS
SELECT
  step_key,
  job_type,
  worker_pool,
  count(*) AS total_runs,
  count(*) FILTER (WHERE success) AS successes,
  count(*) FILTER (WHERE NOT success) AS failures,
  round(avg(duration_ms)) AS avg_duration_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
  round(100.0 * count(*) FILTER (WHERE NOT success) / NULLIF(count(*), 0), 1) AS error_rate_pct,
  max(created_at) AS last_run_at
FROM step_metrics
WHERE created_at > now() - interval '1 hour'
GROUP BY step_key, job_type, worker_pool
ORDER BY p95_duration_ms DESC NULLS LAST;

-- Phase 5C: Pool-level concurrency recommendation view
CREATE OR REPLACE VIEW public.pool_concurrency_recommendation AS
SELECT
  worker_pool,
  count(*) AS runs_1h,
  round(avg(duration_ms)) AS avg_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
  round(100.0 * count(*) FILTER (WHERE NOT success) / NULLIF(count(*), 0), 1) AS error_rate_pct,
  CASE
    WHEN percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) > 40000 THEN 1
    WHEN percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) > 25000 THEN 2
    WHEN round(100.0 * count(*) FILTER (WHERE NOT success) / NULLIF(count(*), 0), 1) > 20 THEN 2
    WHEN percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) < 5000
      AND round(100.0 * count(*) FILTER (WHERE NOT success) / NULLIF(count(*), 0), 1) < 5 THEN 6
    WHEN percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) < 10000 THEN 4
    ELSE 3
  END AS recommended_concurrency
FROM step_metrics
WHERE created_at > now() - interval '1 hour'
GROUP BY worker_pool;

-- Enable RLS on step_metrics (service role writes)
ALTER TABLE public.step_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on step_metrics"
  ON public.step_metrics FOR ALL
  USING (true)
  WITH CHECK (true);