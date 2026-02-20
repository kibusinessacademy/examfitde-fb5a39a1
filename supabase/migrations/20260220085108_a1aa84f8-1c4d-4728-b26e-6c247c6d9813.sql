
-- Must drop dependent views first, then the base view
DROP VIEW IF EXISTS public.ops_step_duration_slowest_7d;
DROP VIEW IF EXISTS public.ops_step_duration_7d;
DROP VIEW IF EXISTS public.ops_step_duration_events;

CREATE VIEW public.ops_step_duration_events
WITH (security_invoker = on) AS
SELECT
  jq.id AS job_id,
  jq.job_type,
  m.step_key,
  (jq.payload->>'package_id') AS package_id,
  jq.status::text AS status,
  jq.attempts,
  jq.created_at,
  jq.started_at,
  jq.completed_at,
  jq.updated_at,
  CASE
    WHEN jq.started_at IS NOT NULL THEN
      greatest(0, extract(epoch FROM (jq.started_at - jq.created_at)) * 1000)::bigint
    ELSE NULL
  END AS queue_wait_ms,
  CASE
    WHEN jq.started_at IS NOT NULL AND jq.completed_at IS NOT NULL THEN
      greatest(0, extract(epoch FROM (jq.completed_at - jq.started_at)) * 1000)::bigint
    ELSE NULL
  END AS run_ms,
  left(coalesce(jq.error,''), 500) AS error_snip
FROM public.job_queue jq
JOIN public.ops_jobtype_step_map m ON m.job_type = jq.job_type
WHERE jq.payload ? 'package_id';

CREATE VIEW public.ops_step_duration_7d
WITH (security_invoker = on) AS
WITH base AS (
  SELECT * FROM public.ops_step_duration_events
  WHERE created_at > now() - interval '7 days'
)
SELECT
  step_key, job_type,
  count(*) FILTER (WHERE status = 'completed') AS completed,
  count(*) FILTER (WHERE status IN ('failed','cancelled')) AS failed_or_cancelled,
  count(*) FILTER (WHERE status = 'processing') AS processing,
  count(*) FILTER (WHERE status = 'pending') AS pending,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY queue_wait_ms) FILTER (WHERE status='completed' AND queue_wait_ms IS NOT NULL) AS qwait_p50_ms,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY queue_wait_ms) FILTER (WHERE status='completed' AND queue_wait_ms IS NOT NULL) AS qwait_p90_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY queue_wait_ms) FILTER (WHERE status='completed' AND queue_wait_ms IS NOT NULL) AS qwait_p95_ms,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_p50_ms,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_p90_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_p95_ms,
  avg(run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_avg_ms,
  max(run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_max_ms,
  avg(attempts) FILTER (WHERE status='completed') AS attempts_avg
FROM base
GROUP BY step_key, job_type
ORDER BY run_p95_ms DESC NULLS LAST;

CREATE VIEW public.ops_step_duration_slowest_7d
WITH (security_invoker = on) AS
SELECT *
FROM public.ops_step_duration_events
WHERE created_at > now() - interval '7 days'
  AND status = 'completed'
ORDER BY run_ms DESC NULLS LAST;

CREATE INDEX IF NOT EXISTS job_queue_started_at_idx
  ON public.job_queue(started_at);

NOTIFY pgrst, 'reload schema';
