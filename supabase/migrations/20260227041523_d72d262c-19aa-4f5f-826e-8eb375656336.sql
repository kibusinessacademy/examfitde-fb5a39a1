
-- RPC: count_active_jobs_for_package
-- Robust server-side count of active (pending/processing) jobs for a package+job_type.
-- Replaces fragile PostgREST "payload->>package_id" filter with proper SQL.
CREATE OR REPLACE FUNCTION public.count_active_jobs_for_package(
  p_package_id uuid,
  p_job_type text DEFAULT NULL,
  p_statuses text[] DEFAULT ARRAY['pending','processing']
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cnt int;
BEGIN
  SELECT count(*)::int INTO v_cnt
  FROM public.job_queue jq
  WHERE jq.status = ANY(p_statuses)
    AND (p_job_type IS NULL OR jq.job_type = p_job_type)
    AND (jq.payload->>'package_id')::uuid = p_package_id;

  RETURN v_cnt;
END;
$$;

REVOKE ALL ON FUNCTION public.count_active_jobs_for_package(uuid, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_active_jobs_for_package(uuid, text, text[]) TO service_role;
