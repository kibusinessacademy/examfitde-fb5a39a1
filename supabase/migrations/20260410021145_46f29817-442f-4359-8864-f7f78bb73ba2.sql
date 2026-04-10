
CREATE OR REPLACE FUNCTION public.fn_heal_track_step_drift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed int := 0;
  v_jobs_cancelled int := 0;
  v_errors_cleared int := 0;
  v_stuck_cleared int := 0;
  v_details jsonb := '[]'::jsonb;
  v_rec record;
BEGIN
  -- ═══ LAYER 1: Track-aware step skipping ═══
  FOR v_rec IN
    SELECT ps.id as step_id, ps.package_id, ps.step_key, ps.status as old_status,
           cp.track, ps.job_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status NOT IN ('skipped')
      AND cp.status NOT IN ('archived', 'cancelled')
      AND (
        (cp.track = 'EXAM_FIRST' AND ps.step_key IN (
          'scaffold_learning_course', 'generate_glossary', 'fanout_learning_content',
          'generate_learning_content', 'finalize_learning_content', 'validate_learning_content',
          'generate_lesson_minichecks', 'validate_lesson_minichecks',
          'generate_handbook', 'validate_handbook',
          'enqueue_handbook_expand', 'expand_handbook', 'validate_handbook_depth'
        ))
        OR
        (cp.track = 'EXAM_FIRST_PLUS' AND ps.step_key IN (
          'scaffold_learning_course', 'generate_glossary', 'fanout_learning_content',
          'generate_learning_content', 'finalize_learning_content', 'validate_learning_content',
          'generate_lesson_minichecks', 'validate_lesson_minichecks',
          'enqueue_handbook_expand', 'expand_handbook', 'validate_handbook_depth'
        ))
        OR
        (cp.track = 'STUDIUM' AND ps.step_key IN (
          'generate_oral_exam', 'validate_oral_exam'
        ))
      )
  LOOP
    UPDATE package_steps
    SET status = 'skipped',
        finished_at = now(),
        last_error = 'auto-healer: track-drift detected, step not required for track ' || v_rec.track
    WHERE id = v_rec.step_id;

    v_healed := v_healed + 1;

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
      'package_id', v_rec.package_id, 'step_key', v_rec.step_key,
      'track', v_rec.track, 'old_status', v_rec.old_status
    );
  END LOOP;

  -- ═══ LAYER 2: Reset STALE_LOCK steps ═══
  FOR v_rec IN
    SELECT ps.id as step_id, ps.package_id, ps.step_key
    FROM package_steps ps
    WHERE ps.status NOT IN ('done', 'skipped')
      AND ps.last_error ILIKE '%STALE_LOCK%'
  LOOP
    UPDATE package_steps
    SET status = 'queued', last_error = NULL, attempts = 0,
        started_at = NULL, finished_at = NULL, job_id = NULL, meta = '{}'::jsonb
    WHERE id = v_rec.step_id;
    
    v_healed := v_healed + 1;
    v_details := v_details || jsonb_build_object(
      'package_id', v_rec.package_id, 'step_key', v_rec.step_key, 'action', 'reset_stale_lock'
    );
  END LOOP;

  -- ═══ LAYER 3 (NEW): Clear stale prereq errors on queued steps ═══
  FOR v_rec IN
    SELECT ps.id as step_id, ps.package_id, ps.step_key, ps.last_error
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'
      AND cp.status = 'building'
      AND ps.last_error IS NOT NULL
      AND (
        ps.last_error ILIKE '%WAITING_FOR_VARIANT_PREBUILD%'
        OR ps.last_error ILIKE '%PREREQ_NOT_DONE%'
        OR ps.last_error ILIKE '%prereq not ready%'
        OR ps.last_error ILIKE '%Artifact missing:%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM package_steps upstream
        WHERE upstream.package_id = ps.package_id
          AND upstream.step_key IN (
            'generate_blueprint_variants', 'promote_blueprint_variants',
            'validate_blueprint_variants', 'auto_seed_exam_blueprints'
          )
          AND upstream.status NOT IN ('done', 'skipped')
      )
  LOOP
    UPDATE package_steps SET last_error = NULL, updated_at = now() WHERE id = v_rec.step_id;
    v_errors_cleared := v_errors_cleared + 1;
    v_details := v_details || jsonb_build_object(
      'package_id', v_rec.package_id, 'step_key', v_rec.step_key,
      'action', 'clear_stale_prereq_error', 'old_error', left(v_rec.last_error, 100)
    );
  END LOOP;

  -- ═══ LAYER 4 (NEW): Clear stale stuck_reason on healthy packages ═══
  FOR v_rec IN
    SELECT cp.id as package_id, cp.stuck_reason
    FROM course_packages cp
    WHERE cp.status = 'building'
      AND cp.stuck_reason IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq WHERE jq.package_id = cp.id AND jq.status = 'failed'
      )
      AND EXISTS (
        SELECT 1 FROM job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('pending', 'processing')
      )
  LOOP
    UPDATE course_packages
    SET stuck_reason = NULL, gate_class = NULL, updated_at = now()
    WHERE id = v_rec.package_id;
    v_stuck_cleared := v_stuck_cleared + 1;
    v_details := v_details || jsonb_build_object(
      'package_id', v_rec.package_id, 'action', 'clear_stale_stuck_reason',
      'old_reason', left(v_rec.stuck_reason, 100)
    );
  END LOOP;

  -- Audit log
  IF (v_healed + v_errors_cleared + v_stuck_cleared) > 0 THEN
    INSERT INTO admin_actions (action, scope, payload)
    VALUES ('track_drift_heal', 'system', jsonb_build_object(
      'healed_steps', v_healed, 'cancelled_jobs', v_jobs_cancelled,
      'errors_cleared', v_errors_cleared, 'stuck_cleared', v_stuck_cleared,
      'details', v_details
    ));

    IF (v_healed + v_errors_cleared + v_stuck_cleared) > 5 THEN
      INSERT INTO admin_notifications (title, body, category, severity, metadata)
      VALUES (
        'Track-Drift Healer: ' || (v_healed + v_errors_cleared + v_stuck_cleared) || ' Korrekturen',
        v_healed || ' Steps übersprungen, ' || v_errors_cleared || ' stale Fehler bereinigt, ' || v_stuck_cleared || ' stuck_reasons gelöscht.',
        'ops', 'warning',
        jsonb_build_object('healed', v_healed, 'cancelled_jobs', v_jobs_cancelled, 'errors_cleared', v_errors_cleared, 'stuck_cleared', v_stuck_cleared)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'healed_steps', v_healed, 'cancelled_jobs', v_jobs_cancelled,
    'errors_cleared', v_errors_cleared, 'stuck_cleared', v_stuck_cleared, 'details', v_details
  );
END;
$$;
