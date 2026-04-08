
-- 1. Zombie-Timeout-Guard: Reset jobs stuck in processing > 60 minutes
CREATE OR REPLACE FUNCTION public.fn_reset_zombie_processing_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  rec record;
BEGIN
  FOR rec IN
    SELECT id, job_type, package_id, started_at,
      EXTRACT(EPOCH FROM (now() - started_at))/60 as minutes_stuck
    FROM job_queue
    WHERE status = 'processing'
      AND started_at < now() - interval '60 minutes'
  LOOP
    UPDATE job_queue
    SET status = 'pending',
        started_at = NULL,
        locked_at = NULL,
        locked_by = NULL,
        last_error = format('ZOMBIE_TIMEOUT_60MIN: was processing for %s min, reset at %s', 
          round(rec.minutes_stuck::numeric), now()),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'zombie_reset_at', now(),
          'zombie_minutes', round(rec.minutes_stuck::numeric)
        ),
        updated_at = now()
    WHERE id = rec.id AND status = 'processing';
    
    v_count := v_count + 1;
    
    INSERT INTO admin_actions (action, user_id, payload, scope)
    VALUES (
      'zombie_timeout_reset',
      '00000000-0000-0000-0000-000000000000',
      jsonb_build_object('job_id', rec.id, 'job_type', rec.job_type, 'minutes_stuck', round(rec.minutes_stuck::numeric)),
      'system'
    );
  END LOOP;
  
  RETURN v_count;
END;
$$;

-- 2. Fix get_step_prerequisite to allow parallelism matching DAG
CREATE OR REPLACE FUNCTION public.get_step_prerequisite(p_step_key text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_step_key
    WHEN 'curriculum_ingest' THEN RETURN NULL;
    WHEN 'scaffold_learning_course' THEN RETURN 'curriculum_ingest';
    WHEN 'auto_seed_exam_blueprints' THEN RETURN 'scaffold_learning_course';
    WHEN 'generate_exam_pool' THEN RETURN 'auto_seed_exam_blueprints';
    -- PARALLEL BLOCK: all three depend on validate_exam_pool only
    WHEN 'generate_oral_exam' THEN RETURN 'validate_exam_pool';
    WHEN 'build_ai_tutor_index' THEN RETURN 'validate_exam_pool';
    WHEN 'generate_handbook' THEN RETURN 'validate_exam_pool';
    -- Validation steps depend on their producers
    WHEN 'validate_tutor_index' THEN RETURN 'build_ai_tutor_index';
    WHEN 'validate_oral_exam' THEN RETURN 'generate_oral_exam';
    WHEN 'validate_handbook_depth' THEN RETURN 'generate_handbook';
    -- Integrity check waits for all validations (use elite_harden as DAG gate)
    WHEN 'run_integrity_check' THEN RETURN 'elite_harden';
    WHEN 'quality_council' THEN RETURN 'run_integrity_check';
    WHEN 'auto_publish' THEN RETURN 'quality_council';
    ELSE RETURN NULL;
  END CASE;
END;
$$;
