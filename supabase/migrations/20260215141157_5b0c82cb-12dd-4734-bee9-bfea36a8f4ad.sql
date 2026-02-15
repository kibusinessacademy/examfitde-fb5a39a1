
CREATE OR REPLACE VIEW public.v_pipeline_execution_health AS
SELECT 
  job_type,
  count(*) FILTER (WHERE status = 'completed') AS completed_24h,
  count(*) FILTER (WHERE status = 'failed') AS failed_24h,
  count(*) FILTER (WHERE status = 'pending') AS pending_now,
  count(*) FILTER (WHERE status = 'processing') AS processing_now,
  round(
    count(*) FILTER (WHERE status = 'failed')::numeric / 
    NULLIF(count(*) FILTER (WHERE status IN ('completed','failed')), 0) * 100, 1
  ) AS error_rate_pct,
  round(avg(duration_sec)::numeric, 1) AS avg_duration_sec,
  round(max(duration_sec)::numeric, 1) AS max_duration_sec,
  round((percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_sec))::numeric, 1) AS p95_duration_sec
FROM (
  SELECT 
    job_type,
    status,
    EXTRACT(EPOCH FROM (completed_at - created_at)) AS duration_sec
  FROM job_queue
  WHERE created_at > now() - interval '24 hours'
) sub
GROUP BY job_type
ORDER BY failed_24h DESC, completed_24h DESC;
