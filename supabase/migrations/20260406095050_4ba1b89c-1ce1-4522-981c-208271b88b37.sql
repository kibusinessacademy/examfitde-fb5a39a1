
CREATE OR REPLACE FUNCTION public.fn_reconcile_package_steps_to_ssot(
  p_package_id uuid,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_track text;
  v_oral_enabled boolean;
  v_skipped_keys text[];
  v_affected_steps text[];
  v_affected_count int := 0;
  v_cancelled_jobs int := 0;
  v_pkg_title text;
BEGIN
  SELECT cp.track, cp.title INTO v_track, v_pkg_title
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF v_track IS NULL THEN
    RETURN jsonb_build_object('error', 'package_not_found', 'package_id', p_package_id);
  END IF;

  -- certification context from course_packages.certification_id
  SELECT c.oral_exam_enabled INTO v_oral_enabled
  FROM course_packages cp
  LEFT JOIN certifications c ON c.id = cp.certification_id
  WHERE cp.id = p_package_id;

  v_skipped_keys := ARRAY[]::text[];

  IF v_track = 'AUSBILDUNG_VOLL' THEN
    v_skipped_keys := v_skipped_keys || ARRAY['elite_harden'];
  END IF;

  IF v_track = 'EXAM_FIRST' THEN
    v_skipped_keys := v_skipped_keys || ARRAY[
      'scaffold_learning_course', 'fanout_learning_content',
      'generate_learning_content', 'finalize_learning_content',
      'validate_learning_content',
      'generate_lesson_minichecks', 'validate_lesson_minichecks',
      'generate_handbook', 'validate_handbook',
      'enqueue_handbook_expand', 'expand_handbook', 'validate_handbook_depth'
    ];
  END IF;

  IF v_track = 'EXAM_FIRST_PLUS' THEN
    v_skipped_keys := v_skipped_keys || ARRAY[
      'scaffold_learning_course', 'fanout_learning_content',
      'generate_learning_content', 'finalize_learning_content',
      'validate_learning_content',
      'generate_lesson_minichecks', 'validate_lesson_minichecks'
    ];
    IF COALESCE(v_oral_enabled, false) = false THEN
      v_skipped_keys := v_skipped_keys || ARRAY['generate_oral_exam', 'validate_oral_exam'];
    END IF;
  END IF;

  IF v_track = 'STUDIUM' THEN
    v_skipped_keys := v_skipped_keys || ARRAY[
      'generate_oral_exam', 'validate_oral_exam', 'elite_harden'
    ];
  END IF;

  SELECT array_agg(ps.step_key), count(*)
  INTO v_affected_steps, v_affected_count
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.step_key = ANY(v_skipped_keys)
    AND ps.status NOT IN ('done', 'skipped');

  IF v_affected_count = 0 OR v_affected_count IS NULL THEN
    RETURN jsonb_build_object(
      'package_id', p_package_id, 'track', v_track,
      'status', 'no_drift', 'steps_fixed', 0
    );
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'package_id', p_package_id, 'track', v_track,
      'title', v_pkg_title, 'dry_run', true,
      'would_skip', v_affected_steps, 'would_fix_count', v_affected_count
    );
  END IF;

  UPDATE package_steps
  SET status = 'skipped', updated_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'reconciled_at', now(), 'reconciled_reason', 'track_ssot_drift', 'original_status', status
      )
  WHERE package_id = p_package_id
    AND step_key = ANY(v_skipped_keys)
    AND status NOT IN ('done', 'skipped');

  UPDATE job_queue
  SET status = 'cancelled', updated_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('cancelled_reason', 'step_reconciled_to_ssot')
  WHERE package_id = p_package_id
    AND status IN ('pending', 'queued', 'failed')
    AND job_type IN (SELECT 'package_' || unnest(v_affected_steps));

  GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;

  INSERT INTO auto_heal_log (
    action_type, trigger_source, target_type, target_id,
    result_status, result_detail, metadata
  ) VALUES (
    'step_reconciled_to_ssot', 'reconciliation_job', 'package', p_package_id::text,
    'success', format('Fixed %s steps, cancelled %s jobs for track %s', v_affected_count, v_cancelled_jobs, v_track),
    jsonb_build_object('track', v_track, 'fixed_steps', v_affected_steps, 'cancelled_jobs', v_cancelled_jobs, 'oral_enabled', v_oral_enabled)
  );

  RETURN jsonb_build_object(
    'package_id', p_package_id, 'track', v_track, 'title', v_pkg_title,
    'steps_fixed', v_affected_count, 'jobs_cancelled', v_cancelled_jobs, 'fixed_steps', v_affected_steps
  );
END;
$$;
