CREATE OR REPLACE VIEW public.v_runner_health_latest AS
WITH recent AS (
  SELECT *
  FROM public.runner_health_log
  WHERE created_at >= now() - interval '5 minutes'
),
latest_per_runner AS (
  SELECT DISTINCT ON (runner_name) runner_name, worker_id, lanes, error_message
  FROM recent
  ORDER BY runner_name, created_at DESC
),
agg AS (
  SELECT
    r.runner_name,
    l.worker_id,
    l.lanes,
    (ARRAY_AGG(r.status ORDER BY r.created_at DESC))[1] AS latest_status,
    l.error_message,
    MAX(r.created_at) AS last_seen_at,
    EXTRACT(EPOCH FROM (now() - MAX(r.created_at)))::int AS seconds_ago,
    SUM(r.passes)::int AS passes,
    SUM(r.claimed)::int AS claimed,
    SUM(r.succeeded)::int AS succeeded,
    SUM(r.failed)::int AS failed,
    AVG(r.runtime_ms)::int AS runtime_ms,
    ROUND(AVG(NULLIF(r.completion_rate, 0))::numeric, 2) AS completion_rate,
    ROUND(AVG(NULLIF(r.claim_rate, 0))::numeric, 2) AS claim_rate
  FROM recent r
  JOIN latest_per_runner l USING (runner_name)
  GROUP BY r.runner_name, l.worker_id, l.lanes, l.error_message
),
last_known AS (
  SELECT DISTINCT ON (runner_name)
    runner_name, worker_id, lanes, status AS latest_status, error_message,
    created_at AS last_seen_at,
    EXTRACT(EPOCH FROM (now() - created_at))::int AS seconds_ago,
    passes, claimed, succeeded, failed, runtime_ms,
    completion_rate, claim_rate
  FROM public.runner_health_log
  WHERE runner_name NOT IN (SELECT runner_name FROM agg)
  ORDER BY runner_name, created_at DESC
)
SELECT
  runner_name, worker_id, lanes,
  CASE
    WHEN latest_status = 'crash' THEN 'crash'
    WHEN seconds_ago <= 300 THEN 'alive'
    WHEN seconds_ago <= 900 THEN 'stale'
    ELSE 'dead'
  END AS health_status,
  seconds_ago, passes, claimed, succeeded, failed, runtime_ms,
  error_message, completion_rate, claim_rate, last_seen_at AS created_at
FROM agg
UNION ALL
SELECT
  runner_name, worker_id, lanes,
  CASE
    WHEN latest_status = 'crash' THEN 'crash'
    WHEN seconds_ago <= 300 THEN 'alive'
    WHEN seconds_ago <= 900 THEN 'stale'
    ELSE 'dead'
  END AS health_status,
  seconds_ago, passes, claimed, succeeded, failed, runtime_ms,
  error_message, completion_rate, claim_rate, last_seen_at AS created_at
FROM last_known;