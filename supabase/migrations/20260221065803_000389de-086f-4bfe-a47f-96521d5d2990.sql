
-- Job-Queue Hygiene RPC
CREATE OR REPLACE FUNCTION public.purge_old_jobs(
  p_older_than_days int DEFAULT 7,
  p_statuses text[] DEFAULT ARRAY['cancelled']
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM job_queue
  WHERE status = ANY(p_statuses)
    AND updated_at < now() - (p_older_than_days || ' days')::interval;
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'deleted', v_deleted,
    'statuses', p_statuses,
    'older_than_days', p_older_than_days,
    'purged_at', now()
  );
END;
$$;

-- Throughput View (wurde auch nicht erstellt)
CREATE OR REPLACE VIEW public.ops_throughput_hourly AS
SELECT
  date_trunc('hour', updated_at) AS hour,
  status,
  COUNT(*) AS job_count
FROM job_queue
WHERE updated_at >= now() - interval '24 hours'
  AND status IN ('completed', 'failed', 'cancelled')
GROUP BY 1, 2
ORDER BY 1 DESC;

-- Pipeline Velocity View
CREATE OR REPLACE VIEW public.ops_pipeline_velocity AS
SELECT
  date_trunc('day', ps.finished_at) AS day,
  ps.step_key,
  COUNT(*) AS completed_count,
  AVG(EXTRACT(EPOCH FROM (ps.finished_at - ps.started_at))) AS avg_duration_seconds
FROM package_steps ps
WHERE ps.status = 'done'
  AND ps.finished_at IS NOT NULL
  AND ps.finished_at >= now() - interval '30 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
