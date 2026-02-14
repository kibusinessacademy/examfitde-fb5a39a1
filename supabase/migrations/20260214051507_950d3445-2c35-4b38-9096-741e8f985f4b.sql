
-- 1) get_active_pipeline_package() — Job-Runner can quickly check which package is active
CREATE OR REPLACE FUNCTION public.get_active_pipeline_package()
RETURNS TABLE(active_package_id uuid, heartbeat_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pl.active_package_id, pl.heartbeat_at
  FROM public.pipeline_lock pl
  WHERE pl.active_package_id IS NOT NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_active_pipeline_package() FROM public;
GRANT EXECUTE ON FUNCTION public.get_active_pipeline_package() TO authenticated, service_role;

-- 2) defer_job() — Defer a job by N seconds with a reason
CREATE OR REPLACE FUNCTION public.defer_job(p_job_id uuid, p_delay_seconds int, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.job_queue
     SET status = 'pending',
         run_after = now() + make_interval(secs => p_delay_seconds),
         last_error = COALESCE(last_error, '') || E'\n[DEFER] ' || p_reason,
         locked_at = NULL,
         locked_by = NULL,
         updated_at = now()
   WHERE id = p_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.defer_job(uuid, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.defer_job(uuid, int, text) TO authenticated, service_role;
