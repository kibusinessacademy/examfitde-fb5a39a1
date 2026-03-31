-- Fix recover_and_reenter_package: MUST clear blocked_reason to prevent
-- trg_enforce_package_status_blocked_invariant from reverting status to 'blocked'
CREATE OR REPLACE FUNCTION public.recover_and_reenter_package(
  p_package_id uuid,
  p_reason text,
  p_trigger_source text DEFAULT 'admin_ops',
  p_actor_user_id uuid DEFAULT NULL
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
  v_reset_steps int := 0;
  v_reentered boolean := false;
  v_eligible boolean := false;
  v_final_status text;
BEGIN
  SELECT * INTO v_pkg FROM public.course_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'package_id', p_package_id, 'error', 'PACKAGE_NOT_FOUND');
  END IF;

  SELECT count(*) INTO v_active_jobs
  FROM public.job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.status IN ('pending', 'queued', 'processing', 'running', 'batch_pending');

  IF v_active_jobs > 0 THEN
    INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
    VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text, 'skipped', 'Skipped: active jobs exist', v_now,
      jsonb_build_object('package_status', v_pkg.status, 'active_jobs', v_active_jobs, 'reason', p_reason, 'actor_user_id', p_actor_user_id));
    RETURN jsonb_build_object('ok', false, 'package_id', p_package_id, 'reason', 'ACTIVE_JOBS_EXIST', 'active_jobs', v_active_jobs,
      'reset_steps', 0, 'eligible_for_reentry', false, 'reentered', false, 'final_status', v_pkg.status);
  END IF;

  -- Reset failed/blocked/timeout steps to queued
  WITH reset AS (
    UPDATE public.package_steps ps
    SET status = 'queued',
        attempts = 0,
        updated_at = v_now,
        started_at = null,
        finished_at = null,
        last_error = left(coalesce(ps.last_error, '') || ' | reset:' || p_reason, 1000),
        meta = (
          CASE WHEN ps.meta IS NOT NULL
          THEN jsonb_strip_nulls(ps.meta - '{loop_guard_blocked,guard_state,consecutive_no_progress,grace_until,stall_reason_code}'::text[])
               || jsonb_build_object('recovered_at', v_now, 'recover_reason', p_reason)
          ELSE jsonb_build_object('recovered_at', v_now, 'recover_reason', p_reason)
          END
        )
    WHERE ps.package_id = p_package_id
      AND ps.status IN ('failed', 'blocked', 'timeout')
    RETURNING ps.step_key
  )
  SELECT count(*) INTO v_reset_steps FROM reset;

  v_eligible := (v_reset_steps > 0) OR (v_pkg.status IN ('blocked', 'quality_gate_failed', 'failed'));

  IF v_eligible THEN
    -- Archive competing visible packages
    IF v_pkg.curriculum_id IS NOT NULL THEN
      UPDATE public.course_packages
      SET status = 'archived', updated_at = v_now
      WHERE curriculum_id = v_pkg.curriculum_id
        AND id <> p_package_id
        AND status IN ('planning','queued','building','failed','published','draft');
    END IF;

    -- CRITICAL FIX: Clear BOTH blocked_reason AND stuck_reason
    -- trg_enforce_package_status_blocked_invariant reverts to 'blocked'
    -- if blocked_reason is still set when status changes to 'building'
    UPDATE public.course_packages
    SET status = 'building',
        stuck_reason = null,
        blocked_reason = null,
        updated_at = v_now
    WHERE id = p_package_id;

    v_reentered := true;
    v_final_status := 'building';
  ELSE
    v_final_status := v_pkg.status;
  END IF;

  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
  VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text,
    CASE WHEN v_reentered THEN 'applied' ELSE 'skipped' END,
    'Reset ' || v_reset_steps || ' steps, reentry=' || v_reentered, v_now,
    jsonb_build_object('package_status_before', v_pkg.status, 'final_status', v_final_status, 'reset_steps', v_reset_steps,
      'reason', p_reason, 'actor_user_id', p_actor_user_id, 'blocked_reason_cleared', v_pkg.blocked_reason IS NOT NULL));

  RETURN jsonb_build_object(
    'ok', true, 'package_id', p_package_id,
    'reset_steps', v_reset_steps,
    'eligible_for_reentry', v_eligible,
    'reentered', v_reentered,
    'final_status', v_final_status,
    'reason', p_reason
  );
END;
$$;