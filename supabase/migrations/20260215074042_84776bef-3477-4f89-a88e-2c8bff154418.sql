
-- ══════════════════════════════════════════════════════════════
-- Harden acquire_next_package_lease with global slot limit
-- Uses advisory lock to serialize slot counting
-- ══════════════════════════════════════════════════════════════

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
  v_package_id uuid;
  v_max_slots int;
  v_active_count int;
BEGIN
  -- Serialize all lease acquisitions globally (advisory lock on fixed key)
  PERFORM pg_advisory_xact_lock(42424242);

  -- Read max slots from config (default 5)
  SELECT coalesce(
    (SELECT (value::int) FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages'),
    5
  ) INTO v_max_slots;

  -- Purge expired leases
  DELETE FROM public.package_leases
  WHERE lease_until < now();

  -- Count active leases
  SELECT count(*) INTO v_active_count
  FROM public.package_leases
  WHERE lease_until > now();

  -- Enforce global slot limit
  IF v_active_count >= v_max_slots THEN
    RETURN NULL;
  END IF;

  -- Find next candidate: queued first, then orphaned building
  SELECT cp.id INTO v_package_id
  FROM public.course_packages cp
  WHERE (
    cp.status = 'queued'
    OR (
      cp.status = 'building'
      AND NOT EXISTS (
        SELECT 1 FROM public.package_leases pl
        WHERE pl.package_id = cp.id AND pl.lease_until > now()
      )
    )
  )
  ORDER BY
    CASE WHEN cp.status = 'queued' THEN 0 ELSE 1 END,
    cp.queue_position ASC NULLS LAST,
    cp.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_package_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Create lease
  INSERT INTO public.package_leases (package_id, runner_id, lease_until)
  VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
  ON CONFLICT (package_id) DO UPDATE
  SET runner_id = p_runner_id,
      lease_until = now() + (p_lease_seconds || ' seconds')::interval;

  -- Set package to building
  UPDATE public.course_packages
  SET status = 'building'
  WHERE id = v_package_id AND status = 'queued';

  RETURN v_package_id;
END;
$$;
