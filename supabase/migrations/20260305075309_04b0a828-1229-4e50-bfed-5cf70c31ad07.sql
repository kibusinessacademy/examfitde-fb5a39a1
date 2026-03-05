
-- RPC for p95 latency lookup (used by lesson-generate-content autopilot)
CREATE OR REPLACE FUNCTION public.get_provider_p95_latency(
  p_job_type text,
  p_window_minutes int DEFAULT 30
)
RETURNS TABLE(p95_ms numeric, sample_count bigint, primary_model text) 
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms,
    COUNT(*) AS sample_count,
    mode() WITHIN GROUP (ORDER BY model) AS primary_model
  FROM ai_usage_log
  WHERE job_type = p_job_type
    AND created_at > now() - (p_window_minutes || ' minutes')::interval
    AND success = true
    AND latency_ms IS NOT NULL;
$$;
