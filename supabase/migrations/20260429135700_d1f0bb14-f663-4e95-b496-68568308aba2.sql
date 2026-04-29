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
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
  v_role text := current_setting('role', true);
  v_session_user text := session_user;
  v_pkg record;
  v_step record;
  v_results jsonb := '[]'::jsonb;
  v_step_actions jsonb;
  v_approved_count int;
  v_active_job_count int;
  v_cancelled_loop_count int;
  v_eligible_steps text[] := ARRAY['repair_exam_pool_quality','run_integrity_check','quality_council','auto_publish'];
  v_eligible_step_status step_status[] := ARRAY['queued','failed','blocked','timeout','pending_enqueue']::step_status[];
  v_force_building boolean;
  v_steps_reset int;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT public.has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
  END IF;
  IF NOT v_is_admin
     AND v_role NOT IN ('service_role')
     AND v_session_user NOT IN ('postgres','supabase_admin','supabase_auth_admin') THEN
    RAISE EXCEPTION 'admin or service_role required (role=%, session_user=%)', v_role, v_session_user;
  END IF;

  IF p_package_ids IS NULL OR array_length(p_package_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'results', '[]'::jsonb);
  END IF;

  FOR v_pkg IN SELECT id, title, status, archived FROM public.course_packages WHERE id = ANY(p_package_ids) LOOP
    v_step_actions := '[]'::jsonb;
    v_steps_reset := 0;

    IF v_pkg.archived IS TRUE THEN
      v_results := v_results || jsonb_build_object('package_id', v_pkg.id, 'title', v_pkg.title, 'skipped', true, 'skip_reason', 'archived');
      CONTINUE;
    END IF;
    IF v_pkg.status NOT IN ('building','blocked') THEN
      v_results := v_results || jsonb_build_object('package_id', v_pkg.id, 'title', v_pkg.title, 'skipped', true, 'skip_reason', 'status_not_building_or_blocked', 'current_status', v_pkg.status);
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_approved_count FROM public.exam_questions WHERE package_id = v_pkg.id AND status = 'approved';
    IF v_approved_count = 0 THEN
      v_results := v_results || jsonb_build_object('package_id', v_pkg.id, 'title', v_pkg.title, 'skipped', true, 'skip_reason', 'no_approved_questions');
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_active_job_count FROM public.job_queue
     WHERE package_id = v_pkg.id AND status IN ('processing','running','pending','queued','retry_scheduled','batch_pending');
    IF v_active_job_count > 0 THEN
      v_results := v_results || jsonb_build_object('package_id', v_pkg.id, 'title', v_pkg.title, 'skipped', true, 'skip_reason', 'active_jobs_exist', 'active_jobs', v_active_job_count);
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_cancelled_loop_count FROM public.job_queue
     WHERE package_id = v_pkg.id AND status = 'cancelled' AND updated_at > now() - interval '30 minutes'
       AND job_type = ANY(ARRAY['package_repair_exam_pool_quality','package_run_integrity_check','package_quality_council','package_auto_publish']);
    IF v_cancelled_loop_count = 0 THEN
      v_results := v_results || jsonb_build_object('package_id', v_pkg.id, 'title', v_pkg.title, 'skipped', true, 'skip_reason', 'no_recent_cancelled_loop');
      CONTINUE;
    END IF;

    v_force_building := (v_pkg.status = 'blocked');

    IF NOT p_dry_run THEN
      IF v_force_building THEN
        UPDATE public.course_packages
        SET status = 'building', blocked_reason = NULL, updated_at = now(),
            meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
              'admin_force_building_reason', 'pending_enqueue_drift_heal',
              'admin_force_building_at', now(),
              'admin_force_building_by', COALESCE(v_caller::text, v_session_user))
        WHERE id = v_pkg.id;
      END IF;

      FOR v_step IN
        SELECT id, step_key, status, attempts FROM public.package_steps
         WHERE package_id = v_pkg.id AND step_key = ANY(v_eligible_steps)
           AND status = ANY(v_eligible_step_status)
      LOOP
        UPDATE public.package_steps
        SET status = CASE WHEN v_step.status::text = 'pending_enqueue' THEN 'pending_enqueue'::step_status ELSE 'queued'::step_status END,
            attempts = 0, last_error = NULL,
            meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
              'reset_reason', p_reason, 'reset_at', now(),
              'reset_by', COALESCE(v_caller::text, v_session_user),
              'previous_status', v_step.status::text, 'previous_attempts', v_step.attempts)
        WHERE id = v_step.id;
        v_steps_reset := v_steps_reset + 1;
        v_step_actions := v_step_actions || jsonb_build_object(
          'step_id', v_step.id, 'step_key', v_step.step_key,
          'previous_status', v_step.status::text,
          'reset_to', CASE WHEN v_step.status::text = 'pending_enqueue' THEN 'pending_enqueue' ELSE 'queued' END);
      END LOOP;

      BEGIN
        PERFORM public.admin_nudge_atomic_trigger(v_pkg.id);
      EXCEPTION WHEN OTHERS THEN
        v_step_actions := v_step_actions || jsonb_build_object('nudge_error', SQLERRM);
      END;

      INSERT INTO public.auto_heal_log (trigger_source, action_type, target_id, target_type, input_params, result_status, metadata)
      VALUES ('cockpit_rpc', 'cockpit_pending_enqueue_drift_heal', v_pkg.id::text, 'course_package',
        jsonb_build_object('reason', p_reason, 'caller', COALESCE(v_caller::text, v_session_user)),
        'success',
        jsonb_build_object('forced_building', v_force_building, 'previous_status', v_pkg.status,
          'approved_questions', v_approved_count, 'cancelled_loop_count', v_cancelled_loop_count,
          'steps_reset', v_steps_reset, 'step_actions', v_step_actions));
    ELSE
      FOR v_step IN
        SELECT id, step_key, status, attempts FROM public.package_steps
         WHERE package_id = v_pkg.id AND step_key = ANY(v_eligible_steps)
           AND status = ANY(v_eligible_step_status)
      LOOP
        v_steps_reset := v_steps_reset + 1;
        v_step_actions := v_step_actions || jsonb_build_object(
          'step_id', v_step.id, 'step_key', v_step.step_key,
          'current_status', v_step.status::text, 'would_reset', true);
      END LOOP;
    END IF;

    v_results := v_results || jsonb_build_object(
      'package_id', v_pkg.id, 'title', v_pkg.title, 'previous_status', v_pkg.status,
      'forced_building', v_force_building, 'approved_questions', v_approved_count,
      'cancelled_loop_count', v_cancelled_loop_count, 'steps_reset', v_steps_reset,
      'step_actions', v_step_actions, 'executed', NOT p_dry_run);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'reason', p_reason,
    'package_count', array_length(p_package_ids, 1), 'results', v_results);
END;
$$;