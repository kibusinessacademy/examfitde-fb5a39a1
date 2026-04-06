
-- Reconciliation function: aligns package_steps with track SSOT
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
  -- 1. Load package track
  SELECT cp.track, cp.title INTO v_track, v_pkg_title
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF v_track IS NULL THEN
    RETURN jsonb_build_object('error', 'package_not_found', 'package_id', p_package_id);
  END IF;

  -- 2. Load certification context for cert-based oral
  SELECT c.oral_exam_enabled INTO v_oral_enabled
  FROM course_packages cp
  JOIN courses co ON co.id = (SELECT course_id FROM course_packages WHERE id = p_package_id LIMIT 1)
  LEFT JOIN certifications c ON c.id = co.certification_id
  WHERE cp.id = p_package_id;

  -- 3. Build skip list based on track SSOT
  v_skipped_keys := ARRAY[]::text[];

  -- AUSBILDUNG_VOLL: no elite_harden
  IF v_track = 'AUSBILDUNG_VOLL' THEN
    v_skipped_keys := v_skipped_keys || ARRAY['elite_harden'];
  END IF;

  -- EXAM_FIRST: no learning course, no handbook, no minichecks
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

  -- EXAM_FIRST_PLUS: no learning course, no minichecks; handbook OK; oral cert-based
  IF v_track = 'EXAM_FIRST_PLUS' THEN
    v_skipped_keys := v_skipped_keys || ARRAY[
      'scaffold_learning_course', 'fanout_learning_content',
      'generate_learning_content', 'finalize_learning_content',
      'validate_learning_content',
      'generate_lesson_minichecks', 'validate_lesson_minichecks'
    ];
    -- Oral exam: skip if not cert-enabled
    IF COALESCE(v_oral_enabled, false) = false THEN
      v_skipped_keys := v_skipped_keys || ARRAY['generate_oral_exam', 'validate_oral_exam'];
    END IF;
  END IF;

  -- STUDIUM: no oral exam, no elite_harden
  IF v_track = 'STUDIUM' THEN
    v_skipped_keys := v_skipped_keys || ARRAY[
      'generate_oral_exam', 'validate_oral_exam', 'elite_harden'
    ];
  END IF;

  -- 4. Find affected steps (queued/pending/failed that should be skipped)
  SELECT array_agg(ps.step_key), count(*)
  INTO v_affected_steps, v_affected_count
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.step_key = ANY(v_skipped_keys)
    AND ps.status NOT IN ('done', 'skipped');

  IF v_affected_count = 0 OR v_affected_count IS NULL THEN
    RETURN jsonb_build_object(
      'package_id', p_package_id,
      'track', v_track,
      'status', 'no_drift',
      'steps_checked', array_length(v_skipped_keys, 1),
      'steps_fixed', 0
    );
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'package_id', p_package_id,
      'track', v_track,
      'title', v_pkg_title,
      'dry_run', true,
      'would_skip', v_affected_steps,
      'would_fix_count', v_affected_count
    );
  END IF;

  -- 5. Set drifted steps to skipped
  UPDATE package_steps
  SET status = 'skipped',
      updated_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'reconciled_at', now(),
        'reconciled_reason', 'track_ssot_drift',
        'original_status', status
      )
  WHERE package_id = p_package_id
    AND step_key = ANY(v_skipped_keys)
    AND status NOT IN ('done', 'skipped');

  -- 6. Cancel matching jobs in job_queue
  UPDATE job_queue
  SET status = 'cancelled',
      updated_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'cancelled_reason', 'step_reconciled_to_ssot'
      )
  WHERE package_id = p_package_id
    AND status IN ('pending', 'queued', 'failed')
    AND job_type IN (
      SELECT 'package_' || unnest(v_affected_steps)
    );

  GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;

  -- 7. Write audit log
  INSERT INTO auto_heal_log (
    action_type, trigger_source, target_type, target_id,
    result_status, result_detail, metadata
  ) VALUES (
    'step_reconciled_to_ssot', 'reconciliation_job', 'package', p_package_id::text,
    'success', format('Fixed %s steps, cancelled %s jobs for track %s', v_affected_count, v_cancelled_jobs, v_track),
    jsonb_build_object(
      'track', v_track,
      'fixed_steps', v_affected_steps,
      'cancelled_jobs', v_cancelled_jobs,
      'oral_enabled', v_oral_enabled
    )
  );

  RETURN jsonb_build_object(
    'package_id', p_package_id,
    'track', v_track,
    'title', v_pkg_title,
    'steps_fixed', v_affected_count,
    'jobs_cancelled', v_cancelled_jobs,
    'fixed_steps', v_affected_steps
  );
END;
$$;

-- Grant execute to authenticated (admin-only usage via RPC)
GRANT EXECUTE ON FUNCTION public.fn_reconcile_package_steps_to_ssot(uuid, boolean) TO authenticated;

-- Batch wrapper: reconcile ALL active packages
CREATE OR REPLACE FUNCTION public.fn_reconcile_all_active_packages(
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_results jsonb[] := ARRAY[]::jsonb[];
  v_result jsonb;
  v_total_fixed int := 0;
BEGIN
  FOR v_pkg IN
    SELECT id FROM course_packages
    WHERE status IN ('building', 'blocked', 'quality_gate_failed')
    ORDER BY track, title
  LOOP
    v_result := fn_reconcile_package_steps_to_ssot(v_pkg.id, p_dry_run);
    IF (v_result->>'steps_fixed')::int > 0 OR (v_result->>'would_fix_count') IS NOT NULL THEN
      v_results := array_append(v_results, v_result);
      v_total_fixed := v_total_fixed + COALESCE((v_result->>'steps_fixed')::int, (v_result->>'would_fix_count')::int, 0);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'packages_with_drift', array_length(v_results, 1),
    'total_steps_fixed', v_total_fixed,
    'details', to_jsonb(v_results)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_reconcile_all_active_packages(boolean) TO authenticated;
