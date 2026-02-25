
-- 1) Security: Revoke public/anon/authenticated access, grant only to service_role
REVOKE ALL ON FUNCTION public.count_active_jobs_for_package(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_active_jobs_for_package(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.count_active_jobs_for_package(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.count_active_jobs_for_package(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.reset_failed_jobs_for_package(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_failed_jobs_for_package(uuid, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.reset_failed_jobs_for_package(uuid, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_failed_jobs_for_package(uuid, text[]) TO service_role;

-- 2) Fix reset RPC: don't zero-out attempts (preserve retry signal), increment instead
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
      started_at = NULL,
      last_error = NULL,
      attempts = COALESCE(attempts, 0) + 1
  WHERE status = 'failed'
    AND payload->>'package_id' = p_package_id::text
    AND (p_job_types IS NULL OR job_type = ANY(p_job_types));

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- 3) Remove SECURITY DEFINER from read-only count RPC (not needed for SELECT)
CREATE OR REPLACE FUNCTION public.count_active_jobs_for_package(p_package_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM job_queue
  WHERE payload->>'package_id' = p_package_id::text
    AND status IN ('pending','processing');
$$;
