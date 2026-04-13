
-- v6.4: Job-type-specific stale thresholds + heartbeat awareness
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
  v_stale_interval interval;
BEGIN
  FOR v_rec IN
    SELECT id, job_type, package_id, locked_at, last_error, last_heartbeat_at
    FROM job_queue
    WHERE status = 'processing'
    ORDER BY locked_at
    LIMIT 50
  LOOP
    -- Job-type-specific stale thresholds (v6.4)
    -- T1_GEN / heavy LLM jobs: 15 minutes
    -- T2_HEAVY: 10 minutes
    -- Everything else: 5 minutes
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

    -- Skip if locked_at is not old enough for this job type
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
        updated_at = now(),
        last_error = 'STALE_PROCESSING_GUARD: auto-reset after ' || 
          extract(epoch from v_stale_interval)/60 || 'min stale lock (was: ' || 
          left(coalesce(v_rec.last_error, 'none'), 100) || ')'
    WHERE id = v_rec.id
      AND status = 'processing';
    
    IF FOUND THEN
      v_reset_count := v_reset_count + 1;
      v_details := v_details || jsonb_build_object(
        'job_id', v_rec.id,
        'job_type', v_rec.job_type,
        'package_id', v_rec.package_id,
        'stale_since', v_rec.locked_at,
        'threshold_minutes', extract(epoch from v_stale_interval)/60
      );
    END IF;
  END LOOP;

  IF v_reset_count > 0 THEN
    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail, metadata)
    VALUES (
      'stale_processing_reset',
      'fn_reset_stale_processing_jobs',
      'job_queue',
      'applied',
      'Reset ' || v_reset_count || ' stale processing jobs (v6.4 job-type-aware)',
      jsonb_build_object('reset_count', v_reset_count, 'jobs', v_details)
    );
  END IF;

  RETURN jsonb_build_object('reset_count', v_reset_count, 'jobs', v_details);
END;
$$;

-- Reset stuck jobs for a fresh start with corrected timeouts
UPDATE job_queue
SET status = 'pending',
    attempts = 0,
    locked_at = NULL,
    locked_by = NULL,
    run_after = NULL,
    updated_at = now(),
    last_error = 'ADMIN_RESET: v6.4 tier reclassification — timeout/stale thresholds corrected'
WHERE status IN ('pending', 'processing')
  AND job_type IN (
    'package_validate_blueprint_variants',
    'package_repair_exam_pool_quality',
    'package_elite_harden',
    'package_generate_oral_exam',
    'package_build_ai_tutor_index'
  );
