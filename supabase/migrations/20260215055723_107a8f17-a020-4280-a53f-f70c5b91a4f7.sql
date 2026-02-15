
-- Fix step_start: also transition from 'enqueued' to 'running'
CREATE OR REPLACE FUNCTION public.step_start(
  p_package_id uuid,
  p_step_key text,
  p_runner_id text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.package_steps
  SET status = 'running',
      attempts = attempts + 1,
      started_at = COALESCE(started_at, now()),
      last_heartbeat_at = now(),
      runner_id = p_runner_id,
      last_error = NULL
  WHERE package_id = p_package_id
    AND step_key = p_step_key
    AND status IN ('queued','failed','timeout','blocked','enqueued');
$$;

-- Fix step_done: also transition from 'enqueued' to 'done'
CREATE OR REPLACE FUNCTION public.step_done(
  p_package_id uuid,
  p_step_key text,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.package_steps
  SET status = 'done',
      finished_at = now(),
      meta = meta || p_meta
  WHERE package_id = p_package_id
    AND step_key = p_step_key
    AND status IN ('running','enqueued');
$$;
