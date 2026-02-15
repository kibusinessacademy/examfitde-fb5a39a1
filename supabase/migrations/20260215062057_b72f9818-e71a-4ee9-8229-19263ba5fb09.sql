
-- Fix #1: step_fail must accept 'enqueued' status (not just 'running')
CREATE OR REPLACE FUNCTION public.step_fail(
  p_package_id uuid,
  p_step_key text,
  p_error text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.package_steps
  SET status = 'failed',
      finished_at = now(),
      last_error = left(p_error, 4000)
  WHERE package_id = p_package_id
    AND step_key = p_step_key
    AND status IN ('running', 'enqueued');
$$;

-- Fix #2: acquire_next_package_lease prioritizes 'queued' over 'building'
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
BEGIN
  -- Purge expired leases first
  DELETE FROM public.package_leases
  WHERE lease_until < now();

  -- Find next candidate: queued first, then building without active lease
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

-- Fix #3: Neuter legacy cleanup_stale_pipeline_lock to prevent it from killing packages
CREATE OR REPLACE FUNCTION public.cleanup_stale_pipeline_lock()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Legacy function neutered: pipeline now uses package_leases exclusively.
  -- Kept as no-op to avoid errors if old cron jobs still reference it.
  RAISE LOG 'cleanup_stale_pipeline_lock called but neutered — use expire_stale_leases instead';
END;
$$;
