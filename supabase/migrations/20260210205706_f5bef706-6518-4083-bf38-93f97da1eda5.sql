
-- Fix SECURITY DEFINER views by making them SECURITY INVOKER
CREATE OR REPLACE VIEW public.ops_job_summary WITH (security_invoker = true) AS
SELECT 
  status,
  count(*) as job_count,
  avg(EXTRACT(EPOCH FROM (COALESCE(completed_at, now()) - created_at))) as avg_duration_seconds,
  max(created_at) as latest_created,
  count(*) FILTER (WHERE created_at > now() - interval '1 hour') as last_hour,
  count(*) FILTER (WHERE created_at > now() - interval '24 hours') as last_24h
FROM job_queue
GROUP BY status;

CREATE OR REPLACE VIEW public.ops_cost_summary WITH (security_invoker = true) AS
SELECT 
  date_trunc('day', created_at)::date as day,
  job_type,
  sum(cost_eur) as total_cost,
  sum(tokens_used) as total_tokens,
  count(*) as runs,
  sum(errors) as errors
FROM ai_worker_usage_daily
WHERE date >= (current_date - interval '30 days')
GROUP BY date_trunc('day', created_at)::date, job_type
ORDER BY day DESC;
