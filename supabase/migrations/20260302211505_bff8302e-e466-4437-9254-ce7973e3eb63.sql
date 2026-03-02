
CREATE OR REPLACE FUNCTION public.auto_retry_stuck_package(p_package_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  retried integer := 0;
BEGIN
  UPDATE job_queue
  SET status = 'pending',
      run_after = now() + interval '30 seconds',
      locked_at = NULL,
      locked_by = NULL,
      updated_at = now()
  WHERE status = 'failed'
    AND (
      package_id = p_package_id
      OR (payload ? 'package_id' AND (payload->>'package_id')::uuid = p_package_id)
    )
    AND attempts < max_attempts
    AND (
      COALESCE(last_error_code, '') IN ('RATE_LIMIT', 'TIMEOUT', 'STALE_LOCK')
      OR COALESCE(last_error, '') ILIKE '%rate limit%'
      OR COALESCE(last_error, '') ILIKE '%timeout%'
      OR COALESCE(last_error, '') ILIKE '%transient%'
      OR COALESCE(error, '') ILIKE '%rate limit%'
      OR COALESCE(error, '') ILIKE '%timeout%'
    )
    AND COALESCE((result->>'permanent')::boolean, false) = false
    AND COALESCE(last_error, '') NOT ILIKE '%"last_error_class":"permanent"%'
    AND COALESCE(last_error, '') NOT ILIKE '%SSOT_GUARD%'
    AND COALESCE(last_error, '') NOT ILIKE '%HTTP 422 PERMANENT%'
    AND COALESCE(error, '') NOT ILIKE '%SSOT_GUARD%'
    AND COALESCE(error, '') NOT ILIKE '%HTTP 422 PERMANENT%';

  GET DIAGNOSTICS retried = ROW_COUNT;

  IF retried > 0 THEN
    UPDATE course_packages
    SET stuck_reason = NULL, updated_at = now()
    WHERE id = p_package_id;
  END IF;

  RETURN retried;
END;
$$;
