-- RPC: Count stalled learning content steps (>10min, next_run_at elapsed or null)
CREATE OR REPLACE FUNCTION pipeline_health_stalled_content(p_since timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM package_steps
  WHERE step_key = 'generate_learning_content'
    AND status IN ('enqueued', 'running')
    AND updated_at < p_since
    AND coalesce((meta->>'next_run_at')::timestamptz, now() - interval '1 minute') <= now();
$$;

-- RPC: Count duplicate pending jobs (same package+type)
CREATE OR REPLACE FUNCTION pipeline_health_duplicate_jobs(p_since timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(cnt - 1), 0)::int
  FROM (
    SELECT count(*) AS cnt
    FROM job_queue
    WHERE created_at > p_since
      AND status IN ('pending', 'processing')
    GROUP BY package_id, job_type
    HAVING count(*) > 1
  ) dupes;
$$;