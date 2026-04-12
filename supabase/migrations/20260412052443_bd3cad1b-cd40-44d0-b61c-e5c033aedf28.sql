
-- Permanent stale-processing safety net (v3.0)
-- Catches any job where Fast-Release failed to commit the pending reset
CREATE OR REPLACE FUNCTION public.fn_reset_stale_processing_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reset_count int := 0;
  v_details jsonb := '[]'::jsonb;
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT id, job_type, package_id, locked_at, last_error
    FROM job_queue
    WHERE status = 'processing'
      AND locked_at < now() - interval '5 minutes'
    ORDER BY locked_at
    LIMIT 50
  LOOP
    UPDATE job_queue
    SET status = 'pending',
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now(),
        last_error = 'STALE_PROCESSING_GUARD: auto-reset after 5min stale lock (was: ' || left(coalesce(v_rec.last_error, 'none'), 100) || ')'
    WHERE id = v_rec.id
      AND status = 'processing';  -- guard: only if still processing
    
    IF FOUND THEN
      v_reset_count := v_reset_count + 1;
      v_details := v_details || jsonb_build_object(
        'job_id', v_rec.id,
        'job_type', v_rec.job_type,
        'package_id', v_rec.package_id,
        'stale_since', v_rec.locked_at
      );
    END IF;
  END LOOP;

  -- Audit log
  IF v_reset_count > 0 THEN
    INSERT INTO auto_heal_log (action, detail)
    VALUES (
      'STALE_PROCESSING_GUARD',
      jsonb_build_object('reset_count', v_reset_count, 'jobs', v_details)
    );
  END IF;

  RETURN jsonb_build_object('reset_count', v_reset_count, 'jobs', v_details);
END;
$$;
