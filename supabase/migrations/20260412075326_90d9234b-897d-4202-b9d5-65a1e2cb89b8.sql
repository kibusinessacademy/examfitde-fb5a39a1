
CREATE OR REPLACE FUNCTION public.fn_reap_zombie_processing_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reaped int := 0;
  v_job record;
BEGIN
  -- Find processing jobs where lock is stale (>10 min) and no recent update
  FOR v_job IN
    SELECT id, job_type, package_id, locked_by, locked_at, last_error
    FROM job_queue
    WHERE status = 'processing'
      AND locked_at < now() - interval '10 minutes'
      AND updated_at < now() - interval '10 minutes'
    ORDER BY locked_at ASC
    LIMIT 50
  LOOP
    UPDATE job_queue
    SET status = 'pending',
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now(),
        last_error = format('ZOMBIE_REAP: was processing since %s by %s, original error: %s',
          v_job.locked_at, coalesce(v_job.locked_by, 'unknown'), coalesce(v_job.last_error, 'none'))
    WHERE id = v_job.id
      AND status = 'processing';

    IF FOUND THEN
      v_reaped := v_reaped + 1;

      INSERT INTO auto_heal_log (
        action_type, trigger_source, target_type, target_id,
        result_status, result_detail, metadata
      ) VALUES (
        'reap_zombie_processing',
        'fn_reap_zombie_processing_jobs',
        'job',
        v_job.id,
        'success',
        format('Reaped zombie %s (locked %s ago by %s)',
          v_job.job_type,
          age(now(), v_job.locked_at),
          coalesce(v_job.locked_by, 'unknown')),
        jsonb_build_object(
          'job_type', v_job.job_type,
          'package_id', v_job.package_id,
          'locked_at', v_job.locked_at,
          'locked_by', v_job.locked_by
        )
      );
    END IF;
  END LOOP;

  RETURN v_reaped;
END;
$$;
