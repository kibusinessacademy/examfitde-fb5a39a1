
-- RPC 1: Count active jobs for a package + job_type
CREATE OR REPLACE FUNCTION public.count_active_jobs(p_package_id uuid, p_job_type text)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM job_queue
  WHERE payload->>'package_id' = p_package_id::text
    AND job_type = p_job_type
    AND status IN ('pending','processing');
$$;

-- RPC 2: Cancel orphan jobs for a package (scoped by statuses)
CREATE OR REPLACE FUNCTION public.cancel_jobs_for_package(p_package_id uuid, p_job_type text, p_statuses text[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_updated int;
BEGIN
  UPDATE job_queue
  SET status = 'cancelled',
      locked_at = null,
      locked_by = null,
      updated_at = now(),
      last_error = coalesce(last_error, '') || ' | auto-finalize cleanup'
  WHERE payload->>'package_id' = p_package_id::text
    AND job_type = p_job_type
    AND status = ANY(p_statuses);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- Grant access only to service_role (pipeline-runner uses service_role)
REVOKE ALL ON FUNCTION public.count_active_jobs(uuid, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_jobs_for_package(uuid, text, text[]) FROM anon, authenticated;
