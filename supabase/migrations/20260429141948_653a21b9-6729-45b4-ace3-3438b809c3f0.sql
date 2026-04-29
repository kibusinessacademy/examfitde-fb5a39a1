-- Step 1: One-time SQL bypass for the 3 drift packages
-- Note: course_packages has no `meta` column — using `feature_flags` for audit tag (consistent with existing RPC).
DO $$
DECLARE
  v_pkg uuid;
BEGIN
  FOREACH v_pkg IN ARRAY ARRAY[
    '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8'::uuid,
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b'::uuid,
    'd14ca583-784f-403d-97a4-34a65ffd961d'::uuid
  ]
  LOOP
    -- Force building + audit tag in feature_flags (course_packages has no meta col)
    UPDATE public.course_packages cp
    SET
      status = 'building',
      blocked_reason = NULL,
      updated_at = now(),
      feature_flags = COALESCE(cp.feature_flags, '{}'::jsonb) || jsonb_build_object(
        'admin_force_building_reason', 'pending_enqueue_drift_heal',
        'admin_force_building_at', now(),
        'admin_force_building_by', 'one_time_sql_bypass'
      )
    WHERE cp.id = v_pkg
      AND cp.status IN ('building','blocked');

    -- Reset tail steps; preserve pending_enqueue, otherwise → queued
    UPDATE public.package_steps ps
    SET
      status = CASE
        WHEN ps.status::text = 'pending_enqueue' THEN 'pending_enqueue'::step_status
        ELSE 'queued'::step_status
      END,
      attempts = 0,
      last_error = NULL,
      updated_at = now(),
      meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
        'reset_reason', 'cockpit_pending_enqueue_drift_heal',
        'reset_at', now(),
        'reset_by', 'one_time_sql_bypass',
        'previous_status', ps.status::text,
        'previous_attempts', ps.attempts
      )
    WHERE ps.package_id = v_pkg
      AND ps.step_key IN (
        'repair_exam_pool_quality',
        'run_integrity_check',
        'quality_council',
        'auto_publish'
      )
      AND ps.status::text IN (
        'queued','failed','blocked','timeout','pending_enqueue','cancelled'
      );

    -- Atomic nudge (errors are non-fatal — logged in step_actions)
    BEGIN
      PERFORM public.admin_nudge_atomic_trigger(v_pkg, false);
    EXCEPTION WHEN OTHERS THEN
      -- swallow; bypass should not crash on nudge issues
      NULL;
    END;

    INSERT INTO public.auto_heal_log(
      trigger_source, action_type, target_type, target_id,
      result_status, result_detail, metadata
    )
    VALUES (
      'one_time_sql_bypass',
      'cockpit_pending_enqueue_drift_heal',
      'course_package',
      v_pkg::text,
      'success',
      'One-time bypass for pending_enqueue drift after approved artifacts verified',
      jsonb_build_object(
        'package_id', v_pkg,
        'reason', 'pending_enqueue_drift_heal',
        'steps', ARRAY[
          'repair_exam_pool_quality','run_integrity_check','quality_council','auto_publish'
        ]
      )
    );
  END LOOP;
END $$;

-- Step 2: Re-harden admin_heal_pending_enqueue_drift AuthZ
-- Remove session_user fallback; keep strict admin OR service_role only.
CREATE OR REPLACE FUNCTION public.admin_heal_pending_enqueue_drift(
  p_package_ids uuid[],
  p_reason text DEFAULT 'cockpit_pending_enqueue_drift_heal',
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg_id uuid;
  v_pkg RECORD;
  v_approved_count int;
  v_active_jobs int;
  v_recent_cancelled int;
  v_step RECORD;
  v_results jsonb := '[]'::jsonb;
  v_pkg_result jsonb;
  v_steps_reset jsonb;
  v_skip_reason text;
  v_force_building boolean;
BEGIN
  -- Strict AuthZ: admin user OR service_role only
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
  THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;

  IF p_package_ids IS NULL OR array_length(p_package_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no package ids provided');
  END IF;

  FOREACH v_pkg_id IN ARRAY p_package_ids
  LOOP
    v_skip_reason := NULL;
    v_force_building := false;
    v_steps_reset := '[]'::jsonb;

    SELECT id, status, archived_at, title
      INTO v_pkg
      FROM public.course_packages
      WHERE id = v_pkg_id;

    IF NOT FOUND THEN
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg_id, 'skipped', true, 'reason', 'not_found'
      );
      CONTINUE;
    END IF;

    IF v_pkg.archived_at IS NOT NULL THEN
      v_skip_reason := 'archived';
    ELSIF v_pkg.status NOT IN ('building','blocked') THEN
      v_skip_reason := 'status_not_building_or_blocked';
    END IF;

    IF v_skip_reason IS NULL THEN
      SELECT count(*) INTO v_approved_count
        FROM public.exam_questions
        WHERE package_id = v_pkg_id AND status = 'approved';
      IF v_approved_count = 0 THEN
        v_skip_reason := 'no_approved_questions';
      END IF;
    END IF;

    IF v_skip_reason IS NULL THEN
      SELECT count(*) INTO v_active_jobs
        FROM public.job_queue
        WHERE package_id = v_pkg_id
          AND status IN ('processing','running','pending','queued','retry_scheduled','batch_pending');
      IF v_active_jobs > 0 THEN
        v_skip_reason := 'active_jobs_exist';
      END IF;
    END IF;

    IF v_skip_reason IS NULL THEN
      SELECT count(*) INTO v_recent_cancelled
        FROM public.job_queue
        WHERE package_id = v_pkg_id
          AND status = 'cancelled'
          AND job_type IN (
            'package_repair_exam_pool_quality',
            'package_run_integrity_check',
            'package_quality_council',
            'package_auto_publish'
          )
          AND COALESCE(updated_at, created_at) > now() - interval '30 minutes';
      IF v_recent_cancelled = 0 THEN
        v_skip_reason := 'no_recent_cancelled_loop';
      END IF;
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg_id,
        'title', v_pkg.title,
        'skipped', true,
        'reason', v_skip_reason
      );
      CONTINUE;
    END IF;

    IF NOT p_dry_run THEN
      IF v_pkg.status = 'blocked' THEN
        UPDATE public.course_packages
        SET status = 'building',
            blocked_reason = NULL,
            updated_at = now(),
            feature_flags = COALESCE(feature_flags, '{}'::jsonb) || jsonb_build_object(
              'admin_force_building_reason', 'pending_enqueue_drift_heal',
              'admin_force_building_at', now(),
              'admin_force_building_by', COALESCE(auth.uid()::text, 'service_role')
            )
        WHERE id = v_pkg_id;
        v_force_building := true;
      END IF;

      FOR v_step IN
        SELECT id, step_key, status, attempts
          FROM public.package_steps
          WHERE package_id = v_pkg_id
            AND step_key IN (
              'repair_exam_pool_quality','run_integrity_check','quality_council','auto_publish'
            )
            AND status::text IN ('queued','failed','blocked','timeout','pending_enqueue','cancelled')
      LOOP
        UPDATE public.package_steps
        SET status = CASE WHEN v_step.status::text = 'pending_enqueue'
                          THEN 'pending_enqueue'::step_status
                          ELSE 'queued'::step_status END,
            attempts = 0,
            last_error = NULL,
            updated_at = now(),
            meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
              'reset_reason', p_reason,
              'reset_at', now(),
              'reset_by', COALESCE(auth.uid()::text, 'service_role'),
              'previous_status', v_step.status::text,
              'previous_attempts', v_step.attempts
            )
        WHERE id = v_step.id;
        v_steps_reset := v_steps_reset || jsonb_build_object(
          'step_key', v_step.step_key, 'previous_status', v_step.status::text
        );
      END LOOP;

      BEGIN
        PERFORM public.admin_nudge_atomic_trigger(v_pkg_id, false);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;

      INSERT INTO public.auto_heal_log(
        trigger_source, action_type, target_type, target_id,
        result_status, result_detail, metadata
      )
      VALUES (
        'cockpit_pending_enqueue_drift_heal',
        'cockpit_pending_enqueue_drift_heal',
        'course_package',
        v_pkg_id::text,
        'success',
        format('Healed %s tail steps; forced_building=%s', jsonb_array_length(v_steps_reset), v_force_building),
        jsonb_build_object(
          'package_id', v_pkg_id,
          'reason', p_reason,
          'forced_building', v_force_building,
          'approved_questions', v_approved_count,
          'recent_cancelled', v_recent_cancelled,
          'steps_reset', v_steps_reset
        )
      );
    END IF;

    v_results := v_results || jsonb_build_object(
      'package_id', v_pkg_id,
      'title', v_pkg.title,
      'eligible', true,
      'dry_run', p_dry_run,
      'forced_building', v_force_building,
      'approved_questions', v_approved_count,
      'recent_cancelled_loops', v_recent_cancelled,
      'steps_reset', v_steps_reset
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'reason', p_reason,
    'count', array_length(p_package_ids, 1),
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_heal_pending_enqueue_drift(uuid[], text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_heal_pending_enqueue_drift(uuid[], text, boolean) TO authenticated, service_role;