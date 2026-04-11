
-- Automatic stale-lock releaser — callable from cron or admin
CREATE OR REPLACE FUNCTION public.fn_release_stale_job_locks(
  p_lock_ttl_minutes int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released int;
BEGIN
  WITH stale AS (
    SELECT id
    FROM job_queue
    WHERE status = 'processing'
      AND locked_at < now() - (p_lock_ttl_minutes || ' minutes')::interval
    FOR UPDATE SKIP LOCKED
  )
  UPDATE job_queue jq
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      started_at = NULL,
      meta = jsonb_set(
        COALESCE(jq.meta, '{}'::jsonb),
        '{auto_lock_ttl_released_at}',
        to_jsonb(now()::text)
      )
  FROM stale
  WHERE jq.id = stale.id;

  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'released', v_released,
    'ttl_minutes', p_lock_ttl_minutes,
    'ran_at', now()
  );
END;
$$;
