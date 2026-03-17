
-- Drop and recreate recover_and_reenter_package with stale-meta stripping
DROP FUNCTION IF EXISTS public.recover_and_reenter_package(uuid, text, text, uuid);

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
  v_meta_stripped int := 0;
  v_reentered boolean := false;
  v_eligible boolean := false;
  v_final_status text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_pkg FROM public.course_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'package_id', p_package_id, 'error', 'PACKAGE_NOT_FOUND');
  END IF;

  SELECT count(*) INTO v_active_jobs
  FROM public.job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.status IN ('pending', 'queued', 'processing', 'running', 'batch_pending');

  SELECT count(*) INTO v_blocked_steps
  FROM public.package_steps ps WHERE ps.package_id = p_package_id AND ps.status = 'blocked';

  SELECT count(*) INTO v_running_steps
  FROM public.package_steps ps WHERE ps.package_id = p_package_id AND ps.status = 'running';

  SELECT count(*) INTO v_requeueable_steps
  FROM public.package_steps ps WHERE ps.package_id = p_package_id
    AND ps.status IN ('failed', 'blocked', 'skipped', 'timeout');

  SELECT EXISTS (
    SELECT 1 FROM public.package_steps ps
    WHERE ps.package_id = p_package_id AND ps.step_key = 'validate_exam_pool'
      AND coalesce(ps.last_error, '') ILIKE '%Escalation Breaker%'
  ) INTO v_escalation_breaker;

  IF v_active_jobs > 0 THEN
    INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
    VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text, 'skipped', 'Skipped: active jobs exist', v_now,
      jsonb_build_object('package_status', v_pkg.status, 'active_jobs', v_active_jobs, 'reason', p_reason, 'actor_user_id', p_actor_user_id));
    RETURN jsonb_build_object('ok', true, 'package_id', p_package_id, 'reset_steps', 0, 'eligible_for_reentry', false, 'reentered', false, 'final_status', v_pkg.status, 'reason', 'ACTIVE_JOBS_EXIST');
  END IF;

  IF v_running_steps > 0 THEN
    INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
    VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text, 'skipped', 'Skipped: running steps exist', v_now,
      jsonb_build_object('package_status', v_pkg.status, 'running_steps', v_running_steps, 'reason', p_reason, 'actor_user_id', p_actor_user_id));
    RETURN jsonb_build_object('ok', true, 'package_id', p_package_id, 'reset_steps', 0, 'eligible_for_reentry', false, 'reentered', false, 'final_status', v_pkg.status, 'reason', 'RUNNING_STEPS_EXIST');
  END IF;

  IF v_escalation_breaker THEN
    INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
    VALUES ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text, 'skipped', 'Skipped: escalation breaker present', v_now,
      jsonb_build_object('package_status', v_pkg.status, 'escalation_breaker', true, 'reason', p_reason, 'actor_user_id', p_actor_user_id));
    RETURN jsonb_build_object('ok', true, 'package_id', p_package_id, 'reset_steps', 0, 'eligible_for_reentry', false, 'reentered', false, 'final_status', 'blocked', 'reason', 'ESCALATION_BREAKER_PRESENT');
  END IF;

  -- ═══ HARDENED: Reset steps AND strip ALL poisonous meta fields ═══
  UPDATE public.package_steps ps
  SET
    status = 'queued',
    updated_at = v_now,
    started_at = null,
    completed_at = null,
    last_error = left(coalesce(ps.last_error, '') || ' | reset:' || p_reason, 1000),
    meta = (
      (coalesce(ps.meta, '{}'::jsonb)
        - 'kill_switch_at'
        - 'terminal_escalation'
        - 'heal_cycles_exhausted'
        - 'heal_cycles'
        - 'heal_reason'
        - 'last_kill_reason'
        - 'reseed_loop_fixed'
        - 'escalation_breaker'
      ) || jsonb_build_object(
        'recovered_at', v_now,
        'recovery_reason', p_reason,
        'recovery_trigger_source', p_trigger_source,
        'stale_meta_stripped', true
      )
    )
  WHERE ps.package_id = p_package_id
    AND ps.status IN ('failed', 'blocked', 'skipped', 'timeout');
  GET DIAGNOSTICS v_reset_steps = ROW_COUNT;

  -- Also strip stale meta from non-failed steps that carry kill-switch artifacts
  UPDATE public.package_steps ps
  SET
    meta = ps.meta - 'kill_switch_at' - 'terminal_escalation' - 'heal_cycles_exhausted' - 'heal_cycles' - 'heal_reason' - 'last_kill_reason',
    updated_at = v_now
  WHERE ps.package_id = p_package_id
    AND ps.status NOT IN ('failed', 'blocked', 'skipped', 'timeout')
    AND (ps.meta ? 'kill_switch_at' OR ps.meta ? 'terminal_escalation' OR ps.meta ? 'heal_cycles_exhausted');
  GET DIAGNOSTICS v_meta_stripped = ROW_COUNT;

  -- Clear blocked_reason on the package
  UPDATE public.course_packages
  SET blocked_reason = NULL, updated_at = v_now
  WHERE id = p_package_id AND blocked_reason IS NOT NULL;

  SELECT count(*) INTO v_requeueable_steps
  FROM public.package_steps ps WHERE ps.package_id = p_package_id AND ps.status IN ('queued', 'enqueued');

  v_eligible := (v_requeueable_steps > 0);

  IF v_eligible THEN
    UPDATE public.course_packages cp SET status = 'building', updated_at = v_now WHERE cp.id = p_package_id;
    v_reentered := true;
    v_final_status := 'building';
  ELSE
    v_final_status := v_pkg.status;
  END IF;

  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
  VALUES (
    'recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text,
    CASE WHEN v_reentered THEN 'success' ELSE 'skipped' END,
    CASE
      WHEN v_reentered THEN 'Recovered steps (stale meta stripped) and re-entered into building'
      WHEN v_reset_steps > 0 THEN 'Recovered steps but not eligible for re-entry'
      ELSE 'No steps to reset'
    END,
    v_now,
    jsonb_build_object(
      'package_status_before', v_pkg.status, 'package_status_after', v_final_status,
      'reset_steps', v_reset_steps, 'meta_stripped_steps', v_meta_stripped,
      'eligible_for_reentry', v_eligible, 'reentered', v_reentered,
      'stale_meta_stripped', true,
      'reason', p_reason, 'actor_user_id', p_actor_user_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'package_id', p_package_id,
    'reset_steps', v_reset_steps, 'meta_stripped_steps', v_meta_stripped,
    'eligible_for_reentry', v_eligible, 'reentered', v_reentered,
    'final_status', v_final_status, 'stale_meta_stripped', true,
    'reason', p_reason
  );
END;
$$;

COMMENT ON FUNCTION public.recover_and_reenter_package(uuid, text, text, uuid) IS
'Atomically resets failed/blocked/skipped/timeout steps, STRIPS poisonous kill-switch meta, clears blocked_reason, and re-enters into building.';

-- ============================================================
-- 2) Zombie-Job Reaper for completed-but-processing anomaly
-- ============================================================
CREATE OR REPLACE FUNCTION public.reap_zombie_completed_jobs(
  p_max_age_minutes integer DEFAULT 30,
  p_reason text DEFAULT 'ZOMBIE_REAPER: completed_at set but still processing'
)
RETURNS TABLE(job_id uuid, package_id uuid, job_type text, completed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH zombies AS (
    SELECT jq.id, jq.package_id, jq.job_type, jq.completed_at
    FROM public.job_queue jq
    WHERE jq.status = 'processing'
      AND jq.completed_at IS NOT NULL
      AND jq.completed_at < now() - make_interval(mins => p_max_age_minutes)
  ),
  cleaned AS (
    UPDATE public.job_queue jq
    SET status = 'cancelled', locked_at = NULL, locked_by = NULL,
        last_error = left(COALESCE(jq.last_error, '') || ' | ' || p_reason, 1000),
        updated_at = now(),
        meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object('zombie_reaped_at', now(), 'zombie_reap_reason', p_reason)
    FROM zombies z WHERE jq.id = z.id
    RETURNING jq.id, jq.package_id, jq.job_type, z.completed_at
  )
  SELECT * FROM cleaned;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_zombie_completed_jobs(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_zombie_completed_jobs(integer, text) TO service_role;
