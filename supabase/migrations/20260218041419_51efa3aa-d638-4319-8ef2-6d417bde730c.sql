
-- Priority Gate: Only allow non-Top-30 packages to be acquired 
-- when ALL Top-30 packages are done/published.
-- This ensures the 5 slots are exclusively used for Top-30 until completion.

CREATE OR REPLACE FUNCTION public.acquire_next_package_lease(
  p_runner_id text,
  p_lease_seconds int DEFAULT 120
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_package_id uuid;
  v_max_slots int;
  v_active_count int;
  v_top30_incomplete int;
BEGIN
  PERFORM pg_advisory_xact_lock(42424242);

  SELECT coalesce(
    (SELECT (value::int) FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages'),
    5
  ) INTO v_max_slots;

  DELETE FROM public.package_leases WHERE lease_until < now();

  SELECT count(*) INTO v_active_count
  FROM public.package_leases WHERE lease_until > now();

  IF v_active_count >= v_max_slots THEN
    RETURN NULL;
  END IF;

  -- Priority Gate: Count incomplete Top-30 packages (priority <= 10)
  SELECT count(*) INTO v_top30_incomplete
  FROM public.course_packages
  WHERE priority <= 10
    AND status NOT IN ('published', 'done');

  -- Pick next package with priority gate enforcement
  SELECT cp.id INTO v_package_id
  FROM public.course_packages cp
  WHERE (
    cp.status IN ('queued', 'failed')
    OR (
      cp.status = 'building'
      AND NOT EXISTS (
        SELECT 1 FROM public.package_leases pl
        WHERE pl.package_id = cp.id AND pl.lease_until > now()
      )
    )
  )
  -- PRIORITY GATE: If Top-30 still incomplete, only pick Top-30 packages
  AND (v_top30_incomplete = 0 OR cp.priority <= 10)
  ORDER BY
    CASE WHEN cp.status = 'queued' THEN 0
         WHEN cp.status = 'building' THEN 1
         WHEN cp.status = 'failed' THEN 2
         ELSE 3 END,
    cp.priority ASC NULLS LAST,
    cp.queue_position ASC NULLS LAST,
    cp.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_package_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.package_leases (package_id, runner_id, lease_until)
  VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
  ON CONFLICT (package_id) DO UPDATE
  SET runner_id = p_runner_id,
      lease_until = now() + (p_lease_seconds || ' seconds')::interval;

  -- Transition queued OR failed → building
  UPDATE public.course_packages
  SET status = 'building', last_error = NULL
  WHERE id = v_package_id AND status IN ('queued', 'failed');

  RETURN v_package_id;
END;
$$;
