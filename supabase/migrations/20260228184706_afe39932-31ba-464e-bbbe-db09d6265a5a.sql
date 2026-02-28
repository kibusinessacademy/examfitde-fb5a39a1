-- Harden lease acquisition: if queued package cannot transition to building (e.g. enrichment gate), skip it safely.
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease(
  p_runner_id text,
  p_lease_seconds integer DEFAULT 600
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package_id uuid;
  v_max_slots int;
  v_active_leases int;
  v_building_count int;
  v_wip_limit int := 5;
  v_top30_incomplete int;
  v_effective_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(42424242);

  SELECT coalesce((SELECT (value #>> '{}')::int FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages'), 5)
  INTO v_max_slots;

  DELETE FROM public.package_leases WHERE lease_until < now();

  SELECT count(*) INTO v_active_leases FROM public.package_leases WHERE lease_until > now();
  IF v_active_leases >= v_max_slots THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_building_count FROM public.course_packages WHERE status = 'building';

  SELECT count(*) INTO v_top30_incomplete
  FROM public.course_packages
  WHERE priority <= 10 AND status NOT IN ('published', 'done', 'blocked');

  SELECT cp.id INTO v_package_id
  FROM public.course_packages cp
  WHERE (
      (cp.status = 'building' AND NOT EXISTS (
         SELECT 1 FROM public.package_leases pl WHERE pl.package_id = cp.id AND pl.lease_until > now()
      ))
      OR (cp.status IN ('queued','failed') AND v_building_count < v_wip_limit)
  )
    AND (v_top30_incomplete = 0 OR cp.priority <= 10)
  ORDER BY
    CASE WHEN cp.status = 'building' THEN 0 WHEN cp.status = 'queued' THEN 1 WHEN cp.status = 'failed' THEN 2 ELSE 3 END,
    cp.priority ASC NULLS LAST,
    cp.queue_position ASC NULLS LAST,
    cp.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_package_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.course_packages
  SET status = 'building', last_error = NULL
  WHERE id = v_package_id AND status IN ('queued','failed');

  SELECT status INTO v_effective_status FROM public.course_packages WHERE id = v_package_id;
  IF v_effective_status <> 'building' THEN
    -- Could not transition (e.g. enrichment gate). Do NOT create lease.
    RETURN NULL;
  END IF;

  INSERT INTO public.package_leases (package_id, runner_id, lease_until)
  VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
  ON CONFLICT (package_id) DO UPDATE
  SET runner_id = p_runner_id,
      lease_until = now() + (p_lease_seconds || ' seconds')::interval;

  RETURN v_package_id;
END;
$$;