
-- Track-drift healer: automatically reconcile step status with track capabilities
CREATE OR REPLACE FUNCTION public.fn_heal_track_step_drift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed int := 0;
  v_jobs_cancelled int := 0;
  v_details jsonb := '[]'::jsonb;
  v_rec record;
BEGIN
  -- Define which steps should be skipped per track
  -- This mirrors the SSOT from contentProfiles.ts
  FOR v_rec IN
    SELECT ps.id as step_id, ps.package_id, ps.step_key, ps.status as old_status,
           cp.track, ps.job_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status NOT IN ('skipped')
      AND cp.status NOT IN ('archived', 'cancelled')
      AND (
        -- EXAM_FIRST: no learning course, no minichecks, no handbook, no handbook expand
        (cp.track = 'EXAM_FIRST' AND ps.step_key IN (
          'scaffold_learning_course', 'generate_glossary', 'fanout_learning_content',
          'generate_learning_content', 'finalize_learning_content', 'validate_learning_content',
          'generate_lesson_minichecks', 'validate_lesson_minichecks',
          'generate_handbook', 'validate_handbook',
          'enqueue_handbook_expand', 'expand_handbook', 'validate_handbook_depth'
        ))
        OR
        -- EXAM_FIRST_PLUS: no learning course, no minichecks, no handbook expand
        (cp.track = 'EXAM_FIRST_PLUS' AND ps.step_key IN (
          'scaffold_learning_course', 'generate_glossary', 'fanout_learning_content',
          'generate_learning_content', 'finalize_learning_content', 'validate_learning_content',
          'generate_lesson_minichecks', 'validate_lesson_minichecks',
          'enqueue_handbook_expand', 'expand_handbook', 'validate_handbook_depth'
        ))
        OR
        -- STUDIUM: no oral exam (optional, not required)
        (cp.track = 'STUDIUM' AND ps.step_key IN (
          'generate_oral_exam', 'validate_oral_exam'
        ) AND NOT EXISTS (
          -- But keep if oral_exam_enabled flag is set
          SELECT 1 FROM course_packages c2 
          WHERE c2.id = cp.id 
          AND (c2.meta->>'oral_exam_enabled')::boolean = true
        ))
      )
  LOOP
    -- Skip the step
    UPDATE package_steps
    SET status = 'skipped',
        finished_at = now(),
        last_error = 'auto-healer: track-drift detected, step not required for track ' || v_rec.track
    WHERE id = v_rec.step_id;

    v_healed := v_healed + 1;

    -- Cancel any associated pending/failed jobs
    IF v_rec.job_id IS NOT NULL THEN
      UPDATE job_queue
      SET status = 'cancelled',
          completed_at = now(),
          result = jsonb_build_object('reason', 'track-drift-healer: step skipped for track')
      WHERE id = v_rec.job_id
        AND status IN ('pending', 'queued', 'failed');
      
      IF FOUND THEN
        v_jobs_cancelled := v_jobs_cancelled + 1;
      END IF;
    END IF;

    v_details := v_details || jsonb_build_object(
      'package_id', v_rec.package_id,
      'step_key', v_rec.step_key,
      'track', v_rec.track,
      'old_status', v_rec.old_status
    );
  END LOOP;

  -- Also detect and reset STALE_LOCK_EXHAUSTED steps
  FOR v_rec IN
    SELECT ps.id as step_id, ps.package_id, ps.step_key
    FROM package_steps ps
    WHERE ps.status NOT IN ('done', 'skipped')
      AND ps.last_error ILIKE '%STALE_LOCK%'
  LOOP
    UPDATE package_steps
    SET status = 'queued',
        last_error = NULL,
        attempts = 0,
        started_at = NULL,
        finished_at = NULL,
        job_id = NULL,
        meta = '{}'::jsonb
    WHERE id = v_rec.step_id;
    
    v_healed := v_healed + 1;
    v_details := v_details || jsonb_build_object(
      'package_id', v_rec.package_id,
      'step_key', v_rec.step_key,
      'action', 'reset_stale_lock'
    );
  END LOOP;

  -- Log if any healing happened
  IF v_healed > 0 THEN
    INSERT INTO admin_actions (action, scope, payload)
    VALUES (
      'track_drift_heal',
      'system',
      jsonb_build_object(
        'healed_steps', v_healed,
        'cancelled_jobs', v_jobs_cancelled,
        'details', v_details
      )
    );

    -- Notify if significant
    IF v_healed > 5 THEN
      INSERT INTO admin_notifications (title, body, category, severity, metadata)
      VALUES (
        'Track-Drift Healer: ' || v_healed || ' Steps korrigiert',
        v_healed || ' Steps wurden automatisch auf skipped gesetzt, da sie nicht zum Track passen. ' || v_jobs_cancelled || ' Jobs wurden storniert.',
        'ops',
        'warning',
        jsonb_build_object('healed', v_healed, 'cancelled_jobs', v_jobs_cancelled)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'healed_steps', v_healed,
    'cancelled_jobs', v_jobs_cancelled,
    'details', v_details
  );
END;
$$;

-- Schedule: run every 30 minutes
SELECT cron.schedule(
  'track-drift-healer',
  '*/30 * * * *',
  $$SELECT public.fn_heal_track_step_drift()$$
);
