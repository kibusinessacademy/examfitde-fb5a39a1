
-- FIX: step_done must also handle 'timeout' status, because expire_stale_steps
-- may have timed out a step whose linked job actually completed successfully.
CREATE OR REPLACE FUNCTION public.step_done(
  p_package_id uuid,
  p_step_key text,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.package_steps
  SET status = 'done',
      finished_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || p_meta
  WHERE package_id = p_package_id
    AND step_key = p_step_key
    AND status IN ('running', 'enqueued', 'timeout');
END;
$$;
