CREATE OR REPLACE FUNCTION public.fn_release_stale_job_locks(
  p_lock_ttl_minutes int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_released int := 0;
  v_stale_interval interval;
BEGIN
  FOR v_rec IN
    SELECT id, job_type, locked_at, last_heartbeat_at
    FROM job_queue
    WHERE status = 'processing'
      AND locked_at IS NOT NULL
    ORDER BY locked_at ASC
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Job-type-specific stale thresholds
    v_stale_interval := CASE
      WHEN v_rec.job_type IN (
        'package_generate_exam_pool', 'package_generate_oral_exam',
        'package_generate_handbook', 'handbook_expand_section',
        'package_generate_learning_content', 'lesson_generate_content_shard',
        'package_generate_lesson_minichecks', 'package_generate_blueprint_variants'
      ) THEN interval '15 minutes'
      WHEN v_rec.job_type IN (
        'package_elite_harden', 'package_repair_exam_pool_quality',
        'package_build_ai_tutor_index', 'package_validate_blueprint_variants'
      ) THEN interval '10 minutes'
      ELSE interval '5 minutes'
    END;

    -- Skip if lock is not stale for this job type
    IF v_rec.locked_at >= now() - v_stale_interval THEN
      CONTINUE;
    END IF;

    -- Heartbeat awareness: skip if heartbeat is fresh (<3 min)
    IF v_rec.last_heartbeat_at IS NOT NULL
       AND v_rec.last_heartbeat_at >= now() - interval '3 minutes' THEN
      CONTINUE;
    END IF;

    UPDATE job_queue
    SET status = 'pending',
        locked_at = NULL,
        locked_by = NULL,
        last_error = 'STALE_LOCK_RECOVERY: lock held >' || EXTRACT(EPOCH FROM v_stale_interval)::int/60 || 'min (type-specific)',
        updated_at = now()
    WHERE id = v_rec.id;

    v_released := v_released + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'released', v_released,
    'ttl_mode', 'job_type_specific',
    'ran_at', now()
  );
END;
$$;