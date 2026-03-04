
CREATE OR REPLACE VIEW public.ops_job_queue_rollup AS
SELECT
  date_trunc('hour', j.created_at) AS hour_bucket,
  j.job_type,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE j.status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE j.status = 'failed') AS failed,
  COUNT(*) FILTER (WHERE j.status = 'failed' AND COALESCE(j.last_error, j.error) ILIKE '%gen=0%') AS gen0_failed,
  COUNT(*) FILTER (WHERE j.status = 'cancelled') AS cancelled,
  COUNT(*) FILTER (WHERE j.status = 'cancelled' AND j.meta->>'outcome' = 'blocked') AS blocked,
  COUNT(*) FILTER (WHERE j.status IN ('pending','queued')) AS pending,
  COUNT(*) FILTER (WHERE j.status = 'processing') AS processing,
  COUNT(*) FILTER (WHERE j.status = 'failed' AND j.attempts >= j.max_attempts) AS exhausted,
  ROUND(AVG(j.attempts) FILTER (WHERE j.status = 'failed'), 2) AS avg_fail_attempts,
  MAX(j.created_at) AS last_activity
FROM job_queue j
WHERE j.created_at >= now() - interval '48 hours'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
