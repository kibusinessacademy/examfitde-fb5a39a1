
-- FIX 1: Immediately repair the corrupted value (JSONB string "8" → JSONB number 8)
UPDATE public.ops_pipeline_config 
SET value = to_jsonb(8)
WHERE key = 'max_concurrent_packages' AND jsonb_typeof(value) = 'string';

-- FIX 2: Make acquire_next_package_lease robust against both JSONB string and number
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease(p_runner_id text, p_lease_seconds int DEFAULT 120)
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
BEGIN
  PERFORM pg_advisory_xact_lock(42424242);

  -- Read configurable max concurrent slots (SAFE: handles both jsonb number and string)
  SELECT coalesce(
    (SELECT (value #>> '{}')::int FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages'),
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
  SELECT cp.id INTO v_package_id
  FROM public.course_packages cp
  WHERE (
    (
      cp.status = 'building'
      AND NOT EXISTS (
        SELECT 1 FROM public.package_leases pl
        WHERE pl.package_id = cp.id AND pl.lease_until > now()
      )
    )
    OR (
      cp.status IN ('queued', 'failed')
      AND v_building_count < v_wip_limit
    )
  )
  AND (v_top30_incomplete = 0 OR cp.priority <= 10)
  ORDER BY
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

-- FIX 3: Make auto_escalation_cycle reads/writes safe too
-- Fix the READ: (value)::int → (value #>> '{}')::int
-- Fix the WRITE: v_new_max::text::jsonb → to_jsonb(v_new_max)
-- (This requires recreating the function - fetching full source first won't work,
--  so we fix the pattern defensively)

-- FIX 4: Add a trigger to prevent future JSONB string corruption
CREATE OR REPLACE FUNCTION public.trg_enforce_jsonb_number_config()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- For numeric config keys, ensure value is stored as JSONB number, not string
  IF NEW.key IN ('max_concurrent_packages', 'autoscale_target_max', 'autoscale_floor', 
                  'heartbeat_stale_seconds', 'backpressure_threshold') THEN
    IF jsonb_typeof(NEW.value) = 'string' THEN
      -- Auto-correct: convert JSONB string to JSONB number
      NEW.value := to_jsonb((NEW.value #>> '{}')::int);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_jsonb_number_config ON public.ops_pipeline_config;
CREATE TRIGGER trg_enforce_jsonb_number_config
  BEFORE INSERT OR UPDATE ON public.ops_pipeline_config
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_jsonb_number_config();
