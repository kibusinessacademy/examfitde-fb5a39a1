
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease(
  p_runner_id text,
  p_lease_seconds int DEFAULT 600
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg_id uuid;
BEGIN
  -- Pick next package: either 'queued' or 'building' without active lease
  WITH next AS (
    SELECT cp.id
    FROM public.course_packages cp
    WHERE (
      cp.status = 'queued'
      OR (
        cp.status = 'building'
        AND NOT EXISTS (
          SELECT 1 FROM public.package_leases pl
          WHERE pl.package_id = cp.id
            AND pl.lease_until > now()
        )
      )
    )
    ORDER BY cp.queue_position ASC NULLS LAST, cp.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  SELECT id INTO v_pkg_id FROM next;

  IF v_pkg_id IS NULL THEN
    RETURN null;
  END IF;

  -- Upsert lease
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
