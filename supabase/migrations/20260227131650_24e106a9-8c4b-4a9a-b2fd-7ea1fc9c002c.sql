-- Queue Pressure View (p95 pending age per pool)
CREATE OR REPLACE VIEW public.job_queue_pressure AS
SELECT
  worker_pool,
  count(*) FILTER (WHERE status = 'pending') AS pending,
  count(*) FILTER (WHERE status = 'processing') AS processing,
  count(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '1 hour') AS failed_1h,
  percentile_cont(0.95)
    WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (now() - created_at)))
    FILTER (WHERE status = 'pending') AS p95_pending_age_sec
FROM public.job_queue
GROUP BY worker_pool;