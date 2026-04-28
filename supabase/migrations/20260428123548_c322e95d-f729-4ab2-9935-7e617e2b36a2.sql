-- Fix admin_retry_failed_step and admin_auto_heal_remaining: align call to admin_step_reset_detailed signature
-- Actual signature: (p_package_id uuid, p_step_keys text[], p_reason text, p_operator text, p_allow_regression boolean, p_clear_exhaustion boolean)

CREATE OR REPLACE FUNCTION public.admin_retry_failed_step(p_package_id uuid, p_step_key text, p_reason text DEFAULT 'manual_per_step_retry'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active_jobs int;
  v_step_exists boolean;
  v_pkg_status  text;
  v_result      jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT status INTO v_pkg_status FROM public.course_packages WHERE id = p_package_id;
  IF v_pkg_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'package_not_found');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.package_steps
     WHERE package_id = p_package_id AND step_key = p_step_key
  ) INTO v_step_exists;

  IF NOT v_step_exists THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'step_not_found', 'step_key', p_step_key);
  END IF;

  SELECT COUNT(*) INTO v_active_jobs
    FROM public.job_queue
   WHERE status IN ('queued','processing','running')
     AND payload ? 'package_id'
     AND (payload->>'package_id')::uuid = p_package_id
     AND (payload->>'step_key' = p_step_key OR job_type ILIKE '%' || p_step_key || '%');

  IF v_active_jobs > 0 THEN
    INSERT INTO public.auto_heal_log
      (trigger_source, action_type, target_id, target_type,
       input_params, result_status, result_detail, error_message)
    VALUES
      ('admin_ui', 'PER_STEP_RETRY', p_package_id::text, 'package',
       jsonb_build_object('step_key', p_step_key, 'reason', p_reason),
       'skipped', 'jobs_already_running',
       format('Skip: %s active jobs already running for %s', v_active_jobs, p_step_key));

    RETURN jsonb_build_object(
      'ok', false, 'skipped', true, 'reason', 'jobs_already_running',
      'active_jobs', v_active_jobs, 'step_key', p_step_key
    );
  END IF;

  -- Reset step (correct signature)
  v_result := public.admin_step_reset_detailed(
    p_package_id       := p_package_id,
    p_step_keys        := ARRAY[p_step_key],
    p_reason           := p_reason,
    p_operator         := 'admin_per_step_retry',
    p_allow_regression := true,
    p_clear_exhaustion := true
  );

  -- Atomic nudge to bypass re-entry guards & promote queued->building
  BEGIN
    PERFORM public.admin_nudge_atomic_trigger(p_package_id, false);
  EXCEPTION WHEN OTHERS THEN
    -- non-fatal
    NULL;
  END;

  INSERT INTO public.auto_heal_log
    (trigger_source, action_type, target_id, target_type,
     input_params, result_status, result_detail)
  VALUES
    ('admin_ui', 'PER_STEP_RETRY', p_package_id::text, 'package',
     jsonb_build_object('step_key', p_step_key, 'reason', p_reason),
     'success', COALESCE(v_result::text, '{}'));

  RETURN jsonb_build_object('ok', true, 'step_key', p_step_key, 'reset_result', v_result);
END;
$function$;


CREATE OR REPLACE FUNCTION public.admin_auto_heal_remaining(p_max_packages integer DEFAULT 25, p_dry_run boolean DEFAULT true)
RETURNS TABLE(package_id uuid, package_title text, track text, action text, step_keys text[], active_jobs integer, skip_reason text, applied boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_reset jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  FOR r IN
    SELECT
      v.package_id, v.package_title, v.track, v.failed_step_keys,
      v.active_jobs, v.heal_state, v.failed_steps, v.last_heal_at
    FROM public.v_admin_heal_status_per_package v
    WHERE v.heal_state IN ('has_failed_steps', 'last_heal_failed')
      AND v.failed_steps > 0
    ORDER BY v.failed_steps DESC, v.last_heal_at NULLS FIRST
    LIMIT GREATEST(p_max_packages, 1)
  LOOP
    IF r.active_jobs > 0 THEN
      package_id    := r.package_id;
      package_title := r.package_title;
      track         := r.track;
      action        := 'skip';
      step_keys     := r.failed_step_keys;
      active_jobs   := r.active_jobs;
      skip_reason   := format('Pipeline-Jobs aktiv (%s) — Auto-Heal pausiert bis Jobs abgeschlossen', r.active_jobs);
      applied       := false;

      IF NOT p_dry_run THEN
        INSERT INTO public.auto_heal_log
          (trigger_source, action_type, target_id, target_type,
           input_params, result_status, error_message)
        VALUES
          ('auto_heal_plan', 'AUTO_HEAL_REMAINING', r.package_id::text, 'package',
           jsonb_build_object('failed_step_keys', r.failed_step_keys),
           'skipped', skip_reason);
      END IF;

      RETURN NEXT;
      CONTINUE;
    END IF;

    package_id    := r.package_id;
    package_title := r.package_title;
    track         := r.track;
    action        := 'reset_and_nudge';
    step_keys     := r.failed_step_keys;
    active_jobs   := 0;
    skip_reason   := NULL;
    applied       := false;

    IF NOT p_dry_run AND COALESCE(array_length(r.failed_step_keys, 1), 0) > 0 THEN
      BEGIN
        v_reset := public.admin_step_reset_detailed(
          p_package_id       := r.package_id,
          p_step_keys        := r.failed_step_keys,
          p_reason           := 'auto_heal_remaining_plan',
          p_operator         := 'auto_heal_plan',
          p_allow_regression := true,
          p_clear_exhaustion := true
        );

        BEGIN
          PERFORM public.admin_nudge_atomic_trigger(r.package_id, false);
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;

        applied := true;

        INSERT INTO public.auto_heal_log
          (trigger_source, action_type, target_id, target_type,
           input_params, result_status, result_detail)
        VALUES
          ('auto_heal_plan', 'AUTO_HEAL_REMAINING', r.package_id::text, 'package',
           jsonb_build_object('failed_step_keys', r.failed_step_keys),
           'success', COALESCE(v_reset::text, '{}'));
      EXCEPTION WHEN OTHERS THEN
        applied := false;
        skip_reason := 'reset_failed: ' || SQLERRM;
        action := 'failed';

        INSERT INTO public.auto_heal_log
          (trigger_source, action_type, target_id, target_type,
           input_params, result_status, error_message)
        VALUES
          ('auto_heal_plan', 'AUTO_HEAL_REMAINING', r.package_id::text, 'package',
           jsonb_build_object('failed_step_keys', r.failed_step_keys),
           'failed', SQLERRM);
      END;
    END IF;

    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$function$;