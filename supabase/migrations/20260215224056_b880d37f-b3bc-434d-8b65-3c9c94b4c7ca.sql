
-- Fix expire_stale_steps: handle NULL timeout_seconds (default to 600s)
CREATE OR REPLACE FUNCTION public.expire_stale_steps()
RETURNS TABLE(package_id uuid, step_key text, runner_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.package_steps ps
  SET status = 'timeout',
      last_error = 'Watchdog: step exceeded timeout_seconds (no heartbeat)',
      finished_at = now()
  WHERE ps.status = 'running'
    AND ps.last_heartbeat_at < now() - make_interval(secs => COALESCE(ps.timeout_seconds, 600))
  RETURNING ps.package_id, ps.step_key, ps.runner_id;
END;
$$;
