CREATE OR REPLACE FUNCTION public.fn_release_stale_job_locks(
  p_lock_ttl_minutes int DEFAULT 3
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
  UPDATE job_queue q
  SET
    status    = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    last_error = 'STALE_LOCK_RECOVERY: lock held >' || p_lock_ttl_minutes || 'min',
    updated_at = now()
  FROM stale s
  WHERE q.id = s.id;

  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'released', v_released,
    'ttl_minutes', p_lock_ttl_minutes,
    'ran_at', now()
  );
END;
$$;