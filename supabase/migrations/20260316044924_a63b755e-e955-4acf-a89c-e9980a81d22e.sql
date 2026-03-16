
CREATE OR REPLACE FUNCTION public.recover_and_reenter_package(
  p_package_id uuid,
  p_reason text,
  p_trigger_source text default 'auto_heal',
  p_actor_user_id uuid default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg public.course_packages%rowtype;
  v_now timestamptz := now();
  v_active_jobs int := 0;
  v_blocked_steps int := 0;
  v_running_steps int := 0;
  v_requeueable_steps int := 0;
  v_escalation_breaker boolean := false;
  v_reset_steps int := 0;
  v_reentered boolean := false;
  v_eligible boolean := false;
  v_final_status text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_pkg FROM public.course_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'package_id', p_package_id, 'error', 'PACKAGE_NOT_FOUND');
  END IF;

  SELECT count(*) INTO v_active_jobs FROM public.job_queue jq
  WHERE jq.package_id = p_package_id AND jq.status IN ('pending', 'queued', 'processing', 'running', 'batch_pending');

  SELECT count(*) INTO v_blocked_steps FROM public.package_steps ps
  WHERE ps.package_id = p_package_id AND ps.status = 'blocked';

  SELECT count(*) INTO v_running_steps FROM public.package_steps ps
  WHERE ps.package_id = p_package_id AND ps.status = 'running';

  SELECT EXISTS (
    SELECT 1 FROM public.package_steps ps
    WHERE ps.package_id = p_package_id AND ps.step_key = 'validate_exam_pool'
      AND coalesce(ps.last_error, '') ILIKE '%Escalation Breaker%'
  ) INTO v_escalation_breaker;

  -- Guards
  IF v_active_jobs > 0 THEN
    INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
    VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text, 'skipped', 'active jobs exist', v_now,
      jsonb_build_object('active_jobs', v_active_jobs, 'reason', p_reason));
    RETURN jsonb_build_object('ok', true, 'package_id', p_package_id, 'reset_steps', 0, 'eligible_for_reentry', false, 'reentered', false, 'final_status', v_pkg.status, 'reason', 'ACTIVE_JOBS_EXIST');
  END IF;

  IF v_running_steps > 0 THEN
    INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
    VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text, 'skipped', 'running steps exist', v_now,
      jsonb_build_object('running_steps', v_running_steps, 'reason', p_reason));
    RETURN jsonb_build_object('ok', true, 'package_id', p_package_id, 'reset_steps', 0, 'eligible_for_reentry', false, 'reentered', false, 'final_status', v_pkg.status, 'reason', 'RUNNING_STEPS_EXIST');
  END IF;

  IF v_escalation_breaker THEN
    INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
    VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text, 'skipped', 'escalation breaker', v_now,
      jsonb_build_object('escalation_breaker', true, 'reason', p_reason));
    RETURN jsonb_build_object('ok', true, 'package_id', p_package_id, 'reset_steps', 0, 'eligible_for_reentry', false, 'reentered', false, 'final_status', 'blocked', 'reason', 'ESCALATION_BREAKER_PRESENT');
  END IF;

  -- Reset failed/blocked/skipped/timeout steps
  UPDATE public.package_steps ps
  SET status = 'queued', updated_at = v_now, started_at = null, finished_at = null,
    last_error = left(coalesce(ps.last_error, '') || ' | reset:' || p_reason, 1000),
    meta = coalesce(ps.meta, '{}'::jsonb) || jsonb_build_object('recovered_at', v_now, 'recovery_reason', p_reason)
  WHERE ps.package_id = p_package_id AND ps.status IN ('failed', 'blocked', 'skipped', 'timeout');
  GET DIAGNOSTICS v_reset_steps = ROW_COUNT;

  -- Check eligibility
  SELECT count(*) INTO v_requeueable_steps FROM public.package_steps ps
  WHERE ps.package_id = p_package_id AND ps.status IN ('queued', 'enqueued');
  v_eligible := (v_requeueable_steps > 0);

  -- Re-enter
  IF v_eligible THEN
    UPDATE public.course_packages SET status = 'building', updated_at = v_now WHERE id = p_package_id;
    v_reentered := true;
    v_final_status := 'building';
  ELSE
    v_final_status := v_pkg.status;
  END IF;

  -- Audit
  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
  VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text,
    CASE WHEN v_reentered THEN 'success' ELSE 'skipped' END,
    CASE WHEN v_reentered THEN 'Re-entered into building' WHEN v_reset_steps > 0 THEN 'Reset steps but not eligible' ELSE 'No steps to reset' END,
    v_now,
    jsonb_build_object('status_before', v_pkg.status, 'status_after', v_final_status, 'reset_steps', v_reset_steps,
      'eligible', v_eligible, 'reentered', v_reentered, 'open_steps', v_requeueable_steps, 'reason', p_reason, 'actor', p_actor_user_id));

  RETURN jsonb_build_object('ok', true, 'package_id', p_package_id, 'reset_steps', v_reset_steps,
    'eligible_for_reentry', v_eligible, 'reentered', v_reentered, 'final_status', v_final_status, 'reason', p_reason);
END;
$$;
