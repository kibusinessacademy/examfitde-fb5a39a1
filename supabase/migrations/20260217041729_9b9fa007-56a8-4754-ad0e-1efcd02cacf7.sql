
-- BUG FIX 1: acquire_next_package_lease must also consider 'failed' packages
-- that still have runnable steps (not all exhausted). This prevents packages from
-- getting permanently stuck after a transient failure.
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

  -- Now also picks up 'failed' packages (they may have runnable steps remaining)
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

-- BUG FIX 2: expire_stale_steps should NOT expire 'enqueued' steps
-- Only 'running' steps should be subject to heartbeat timeout.
-- 'enqueued' steps are waiting for the job-runner to pick them up,
-- which can take longer than the heartbeat timeout.
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
      finished_at = now(),
      last_error = 'Watchdog: step exceeded timeout_seconds (no heartbeat)'
  WHERE ps.status = 'running'  -- ONLY running, NOT enqueued
    AND ps.last_heartbeat_at IS NOT NULL
    AND ps.last_heartbeat_at < now() - (COALESCE(ps.timeout_seconds, 600) || ' seconds')::interval
  RETURNING ps.package_id, ps.step_key, ps.runner_id;
END;
$$;

-- BUG FIX 3: Reset Bankkaufmann from failed → building so runner can pick it up
UPDATE public.course_packages
SET status = 'building', last_error = NULL
WHERE id = 'c25f9ee0-518f-44d2-ac49-72f6731608a2'
  AND status = 'failed';

-- BUG FIX 4: Sync build_progress for all active packages  
UPDATE public.course_packages cp
SET build_progress = (
  SELECT ROUND((count(*) FILTER (WHERE ps.status IN ('done','skipped'))::numeric / NULLIF(count(*),0)) * 100)
  FROM package_steps ps
  WHERE ps.package_id = cp.id
)
WHERE cp.status IN ('building','queued','planning','failed');
