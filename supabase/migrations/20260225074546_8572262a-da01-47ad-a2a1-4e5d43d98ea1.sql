
-- RPC 1: Count active (pending/processing) jobs for a package (deterministic JSONB extract)
CREATE OR REPLACE FUNCTION public.count_active_jobs_for_package(p_package_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM job_queue
  WHERE payload->>'package_id' = p_package_id::text
    AND status IN ('pending','processing');
$$;

-- RPC 2: Reset failed jobs for a package, optionally filtered by job_types
CREATE OR REPLACE FUNCTION public.reset_failed_jobs_for_package(
  p_package_id uuid,
  p_job_types text[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE job_queue
  SET status = 'pending',
      attempts = 0,
      started_at = NULL,
      last_error = NULL
  WHERE status = 'failed'
    AND payload->>'package_id' = p_package_id::text
    AND (p_job_types IS NULL OR job_type = ANY(p_job_types));

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;
