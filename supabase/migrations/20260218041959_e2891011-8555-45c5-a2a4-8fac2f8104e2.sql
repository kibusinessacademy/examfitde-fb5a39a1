
-- WIP-Limit: Exakt 5 Pakete gleichzeitig im Build.
-- Wenn ein Paket published wird, rückt das nächste queued Top-30 nach.
-- Erst wenn alle Top-30 fertig sind, werden Prio-100 freigegeben.

CREATE OR REPLACE FUNCTION public.acquire_next_package_lease(
  p_runner_id text,
  p_lease_seconds int DEFAULT 120
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_package_id uuid;
  v_max_slots int;
  v_active_leases int;
  v_building_count int;
  v_wip_limit int := 5;
  v_top30_incomplete int;
BEGIN
  PERFORM pg_advisory_xact_lock(42424242);

  -- Read configurable max concurrent slots (runner parallelism)
  SELECT coalesce(
    (SELECT (value::int) FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages'),
    5
  ) INTO v_max_slots;

  -- Cleanup expired leases
  DELETE FROM public.package_leases WHERE lease_until < now();

  -- Check active lease count
  SELECT count(*) INTO v_active_leases
  FROM public.package_leases WHERE lease_until > now();

  IF v_active_leases >= v_max_slots THEN
    RETURN NULL;
  END IF;

  -- WIP-Limit: Count packages currently in 'building' status
  SELECT count(*) INTO v_building_count
  FROM public.course_packages
  WHERE status = 'building';

  -- Priority Gate: Count incomplete Top-30 packages
  SELECT count(*) INTO v_top30_incomplete
  FROM public.course_packages
  WHERE priority <= 10
    AND status NOT IN ('published', 'done');

  -- Pick next package:
  -- 1. ONLY pick already-building packages (they need runner attention)
  -- 2. OR pick a queued package IF we're below WIP limit
  -- 3. Respect Top-30 priority gate
  SELECT cp.id INTO v_package_id
  FROM public.course_packages cp
  WHERE (
    -- Already building but no active lease → needs runner
    (
      cp.status = 'building'
      AND NOT EXISTS (
        SELECT 1 FROM public.package_leases pl
        WHERE pl.package_id = cp.id AND pl.lease_until > now()
      )
    )
    -- OR queued/failed and WIP limit not reached
    OR (
      cp.status IN ('queued', 'failed')
      AND v_building_count < v_wip_limit
    )
  )
  -- Top-30 gate: only allow lower-priority when Top-30 are all done
  AND (v_top30_incomplete = 0 OR cp.priority <= 10)
  ORDER BY
    -- Prefer already-building (they have progress)
    CASE WHEN cp.status = 'building' THEN 0
         WHEN cp.status = 'queued' THEN 1
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

  -- Create/update lease
  INSERT INTO public.package_leases (package_id, runner_id, lease_until)
  VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
  ON CONFLICT (package_id) DO UPDATE
  SET runner_id = p_runner_id,
      lease_until = now() + (p_lease_seconds || ' seconds')::interval;

  -- Transition queued/failed → building
  UPDATE public.course_packages
  SET status = 'building', last_error = NULL
  WHERE id = v_package_id AND status IN ('queued', 'failed');

  RETURN v_package_id;
END;
$$;
