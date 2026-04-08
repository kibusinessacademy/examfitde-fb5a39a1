
-- Add job-type-specific zombie timeout to policies
ALTER TABLE job_type_policies ADD COLUMN IF NOT EXISTS zombie_timeout_minutes integer DEFAULT 60;

-- Set specific timeouts for heavy vs light job types
UPDATE job_type_policies SET zombie_timeout_minutes = 90 
WHERE job_type IN (
  'package_generate_exam_pool', 'package_generate_handbook', 
  'package_generate_oral_exam', 'package_generate_learning_content',
  'package_quality_council', 'package_generate_blueprint_variants'
);
UPDATE job_type_policies SET zombie_timeout_minutes = 45 
WHERE job_type IN (
  'package_auto_publish', 'package_run_integrity_check',
  'package_validate_blueprints', 'package_validate_handbook_depth',
  'package_validate_tutor_index', 'package_validate_oral_exam',
  'package_validate_exam_pool', 'package_generate_glossary'
);

-- Replace the naive zombie guard with hardened version
CREATE OR REPLACE FUNCTION public.fn_reset_zombie_processing_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_failed integer := 0;
  rec record;
  v_timeout_min integer;
  v_reclaim_count integer;
  v_zombie_resets integer;
  v_action text;
BEGIN
  FOR rec IN
    SELECT j.id, j.job_type, j.package_id, j.started_at, j.updated_at,
      j.last_heartbeat_at, j.meta, j.attempts, j.max_attempts,
      EXTRACT(EPOCH FROM (now() - j.started_at))/60 as minutes_processing,
      EXTRACT(EPOCH FROM (now() - COALESCE(j.last_heartbeat_at, j.updated_at)))/60 as minutes_since_activity,
      COALESCE(p.zombie_timeout_minutes, 60) as timeout_minutes
    FROM job_queue j
    LEFT JOIN job_type_policies p ON p.job_type = j.job_type
    WHERE j.status = 'processing'
      AND j.started_at < now() - interval '15 minutes'  -- minimum 15min before considering
  LOOP
    v_timeout_min := rec.timeout_minutes;
    v_reclaim_count := COALESCE((rec.meta->>'artifact_block_count')::int, 0) 
                     + COALESCE((rec.meta->>'zombie_reset_count')::int, 0);
    v_zombie_resets := COALESCE((rec.meta->>'zombie_reset_count')::int, 0);
    
    -- Skip if recent heartbeat (active worker)
    IF rec.minutes_since_activity < 15 THEN
      CONTINUE;
    END IF;
    
    -- Skip if processing time under job-type-specific timeout
    IF rec.minutes_processing < v_timeout_min THEN
      CONTINUE;
    END IF;
    
    -- Decision: terminal fail or retry?
    IF v_zombie_resets >= 5 OR v_reclaim_count >= 8 THEN
      -- Terminal fail: too many zombie resets or reclaim loops
      v_action := 'zombie_terminal_fail';
      UPDATE job_queue
      SET status = 'failed',
          last_error = format('ZOMBIE_TERMINAL_FAIL: %s resets, %s reclaims, %s min processing. Exceeded retry limit.',
            v_zombie_resets, v_reclaim_count, round(rec.minutes_processing::numeric)),
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'zombie_terminal_at', now(),
            'zombie_reset_count', v_zombie_resets,
            'reclaim_loop_detected', v_reclaim_count >= 8,
            'final_minutes_processing', round(rec.minutes_processing::numeric)
          ),
          completed_at = now(),
          updated_at = now()
      WHERE id = rec.id AND status = 'processing';
      v_failed := v_failed + 1;
    ELSE
      -- Retry with backoff
      v_action := 'zombie_reset_with_backoff';
      UPDATE job_queue
      SET status = 'pending',
          started_at = NULL,
          locked_at = NULL,
          locked_by = NULL,
          run_after = now() + interval '10 minutes',
          last_error = format('ZOMBIE_RESET: %s min no activity, reset #%s, backoff 10min',
            round(rec.minutes_since_activity::numeric), v_zombie_resets + 1),
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'zombie_reset_at', now(),
            'zombie_reset_count', v_zombie_resets + 1,
            'zombie_minutes_stuck', round(rec.minutes_processing::numeric),
            'zombie_minutes_no_heartbeat', round(rec.minutes_since_activity::numeric)
          ),
          updated_at = now()
      WHERE id = rec.id AND status = 'processing';
    END IF;
    
    v_count := v_count + 1;
    
    INSERT INTO admin_actions (action, user_id, payload, scope)
    VALUES (
      v_action,
      '00000000-0000-0000-0000-000000000000',
      jsonb_build_object(
        'job_id', rec.id, 
        'job_type', rec.job_type,
        'package_id', rec.package_id,
        'minutes_processing', round(rec.minutes_processing::numeric),
        'minutes_no_activity', round(rec.minutes_since_activity::numeric),
        'zombie_resets', v_zombie_resets + 1,
        'reclaim_count', v_reclaim_count,
        'timeout_used', v_timeout_min
      ),
      'system'
    );
  END LOOP;
  
  RAISE LOG '[zombie-guard] Processed % zombies (% reset, % terminal-failed)', 
    v_count, v_count - v_failed, v_failed;
  RETURN v_count;
END;
$$;
