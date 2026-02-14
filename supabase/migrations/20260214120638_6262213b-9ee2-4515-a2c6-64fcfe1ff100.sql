-- Seed package_steps for all existing course_packages that don't have steps yet
INSERT INTO public.package_steps (package_id, step_key, status, max_attempts, timeout_seconds)
SELECT p.id, s.step_key, 'queued'::public.step_status, s.max_attempts, s.timeout_seconds
FROM public.course_packages p
CROSS JOIN (
  VALUES
    ('scaffold_learning_course', 3, 900),
    ('generate_exam_pool',       3, 1800),
    ('generate_oral_exam',       3, 900),
    ('build_ai_tutor_index',     3, 900),
    ('generate_handbook',        3, 900),
    ('run_integrity_check',      2, 600),
    ('quality_council',          2, 900),
    ('auto_publish',             2, 600)
) AS s(step_key, max_attempts, timeout_seconds)
WHERE NOT EXISTS (
  SELECT 1 FROM public.package_steps ps
  WHERE ps.package_id = p.id AND ps.step_key = s.step_key
);

-- Expire stale steps RPC (used by watchdog)
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
    AND ps.last_heartbeat_at < now() - make_interval(secs => ps.timeout_seconds)
  RETURNING ps.package_id, ps.step_key, ps.runner_id;
END;
$$;

-- Expire stale leases RPC (used by watchdog)
CREATE OR REPLACE FUNCTION public.expire_stale_leases()
RETURNS TABLE(package_id uuid, runner_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  DELETE FROM public.package_leases pl
  WHERE pl.lease_until < now()
  RETURNING pl.package_id, pl.runner_id;
END;
$$;

-- Harden execute
REVOKE ALL ON FUNCTION public.expire_stale_steps() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_steps() FROM anon;
REVOKE ALL ON FUNCTION public.expire_stale_steps() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_steps() TO service_role;

REVOKE ALL ON FUNCTION public.expire_stale_leases() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_leases() FROM anon;
REVOKE ALL ON FUNCTION public.expire_stale_leases() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_leases() TO service_role;