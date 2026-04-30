
CREATE OR REPLACE FUNCTION public.admin_heal_exam_pool_too_small(
  p_package_id uuid,
  p_force_chain_reset boolean DEFAULT false,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
  v_pkg record;
  v_repair_action jsonb;
  v_recommended_step text;
  v_repair_recently_failed boolean := false;
  v_chain_reset_done boolean := false;
  v_nudged boolean := false;
  v_result jsonb;
  v_steps_to_reset text[];
BEGIN
  -- Authorization
  IF current_setting('role', true) = 'service_role' THEN
    v_is_admin := true;
  ELSIF v_caller IS NOT NULL THEN
    SELECT public.has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
  END IF;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  -- Load package
  SELECT id, status, current_step, course_id
    INTO v_pkg
  FROM public.course_packages
  WHERE id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_found', 'package_id', p_package_id);
  END IF;

  -- Determine repair action via existing selector
  BEGIN
    SELECT public.fn_select_exam_pool_repair_action(p_package_id) INTO v_repair_action;
  EXCEPTION WHEN OTHERS THEN
    v_repair_action := jsonb_build_object('action', 'unknown', 'reason', SQLERRM);
  END;

  v_recommended_step := COALESCE(v_repair_action->>'action', 'package_repair_exam_pool_quality');

  -- Check: did the recommended repair recently fail / no-op?
  -- Heuristic: same step has run in last 6h with no progress in approved_questions
  SELECT EXISTS (
    SELECT 1
    FROM public.queue_jobs qj
    WHERE qj.package_id = p_package_id
      AND qj.job_type IN (
        'package_repair_exam_pool_quality',
        'package_repair_exam_pool_lf_coverage',
        'package_repair_exam_pool_competency_coverage'
      )
      AND qj.status IN ('completed','failed')
      AND qj.completed_at > now() - interval '6 hours'
  ) INTO v_repair_recently_failed;

  -- Decide chain reset
  IF p_force_chain_reset OR v_repair_recently_failed THEN
    v_steps_to_reset := ARRAY[
      'generate_exam_pool',
      'validate_exam_pool',
      'repair_exam_pool_quality'
    ];

    IF NOT p_dry_run THEN
      PERFORM public.admin_step_reset_detailed(
        p_package_id      := p_package_id,
        p_step_keys       := v_steps_to_reset,
        p_reason          := 'exam_pool_too_small_combined_heal',
        p_operator        := COALESCE(v_caller::text, 'service_role'),
        p_allow_regression := true,
        p_clear_exhaustion := true
      );
      v_chain_reset_done := true;

      PERFORM public.admin_nudge_atomic_trigger(p_package_id, false);
      v_nudged := true;
    END IF;
  ELSE
    -- Just trigger the targeted recheck which will enqueue the right repair job
    IF NOT p_dry_run THEN
      PERFORM public.admin_targeted_blocker_recheck(true);
      v_nudged := true;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'package_status', v_pkg.status,
    'current_step', v_pkg.current_step,
    'repair_action', v_repair_action,
    'recommended_step', v_recommended_step,
    'repair_recently_failed', v_repair_recently_failed,
    'chain_reset_done', v_chain_reset_done,
    'nudged', v_nudged,
    'dry_run', p_dry_run,
    'force_chain_reset', p_force_chain_reset
  );

  -- Audit log
  IF NOT p_dry_run THEN
    INSERT INTO public.auto_heal_log (action_type, package_id, metadata, created_at)
    VALUES ('exam_pool_too_small_combined_heal', p_package_id, v_result, now());
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_heal_exam_pool_too_small(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_heal_exam_pool_too_small(uuid, boolean, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
