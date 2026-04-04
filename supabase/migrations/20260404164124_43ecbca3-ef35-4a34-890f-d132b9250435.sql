CREATE OR REPLACE FUNCTION public.count_recent_fanout_jobs(
  p_package_id uuid,
  p_window interval DEFAULT interval '30 minutes'
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM job_queue
  WHERE job_type LIKE '%fanout_learning_content%'
    AND payload->>'package_id' = p_package_id::text
    AND created_at >= now() - p_window;
$$;