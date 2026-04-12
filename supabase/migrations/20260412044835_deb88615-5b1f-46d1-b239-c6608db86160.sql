
-- Fix: count_active_jobs should exclude stale processing jobs (locked_at > 5 min ago)
-- Root cause: stale processing jobs block FINALIZATION_RULES even when step meta shows ok=true
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
    AND (
      status = 'pending'
      OR (status = 'processing' AND locked_at > now() - interval '5 minutes')
    );
$$;
