-- Fix: add locked_at column if missing
ALTER TABLE public.course_packages ADD COLUMN IF NOT EXISTS locked_at timestamptz;

-- Recreate acquire_next_package_lease without locked_at reference
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease(
  p_runner_id text,
  p_lease_seconds int default 600
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg_id uuid;
  v_active_leases int;
BEGIN
  SELECT count(*) INTO v_active_leases
  FROM public.package_leases
  WHERE lease_until > now();

  IF v_active_leases > 0 THEN
    RETURN null;
  END IF;

  WITH next AS (
    SELECT id
    FROM public.course_packages
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  SELECT id INTO v_pkg_id FROM next;

  IF v_pkg_id IS NULL THEN
    RETURN null;
  END IF;

  INSERT INTO public.package_leases(package_id, runner_id, lease_until)
  VALUES (v_pkg_id, p_runner_id, now() + make_interval(secs => p_lease_seconds))
  ON CONFLICT (package_id) DO UPDATE
    SET runner_id = excluded.runner_id,
        lease_until = excluded.lease_until,
        renewed_at = now();

  UPDATE public.course_packages
  SET status = 'building'
  WHERE id = v_pkg_id;

  RETURN v_pkg_id;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_next_package_lease(text,int) FROM public;
GRANT EXECUTE ON FUNCTION public.acquire_next_package_lease(text,int) TO service_role;