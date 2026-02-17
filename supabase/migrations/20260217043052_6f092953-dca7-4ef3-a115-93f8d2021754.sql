
-- Must drop and recreate since return type changed
DROP FUNCTION IF EXISTS public.expire_stale_steps();

CREATE OR REPLACE FUNCTION public.expire_stale_steps()
RETURNS TABLE(package_id uuid, step_key text, runner_id text, job_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.package_steps ps
  SET status = 'timeout',
      finished_at = now(),
      last_error = 'Watchdog: step exceeded timeout_seconds (no heartbeat)'
  WHERE ps.status = 'running'
    AND ps.last_heartbeat_at IS NOT NULL
    AND ps.last_heartbeat_at < now() - (COALESCE(ps.timeout_seconds, 600) || ' seconds')::interval
  RETURNING ps.package_id, ps.step_key, ps.runner_id, ps.job_id;
END;
$function$;
