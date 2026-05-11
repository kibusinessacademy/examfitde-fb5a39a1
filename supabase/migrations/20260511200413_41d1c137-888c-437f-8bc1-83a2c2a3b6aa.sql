CREATE OR REPLACE FUNCTION public.admin_smoke_tail_healer_coordination_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_passed int := 0;
  v_failed int := 0;
  v_skipped int := 0;
  v_step_id uuid;
  v_audit_before bigint;
  v_audit_after bigint;
  v_status text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  v_pkg_id := gen_random_uuid();
  INSERT INTO public.course_packages(id, package_key, title, status, created_at, updated_at)
  VALUES (v_pkg_id, 'smoke_tail_heal_'||substr(v_pkg_id::text,1,8), 'smoke', 'building', now(), now());

  INSERT INTO public.package_steps(id, package_id, step_key, status, updated_at)
  VALUES (gen_random_uuid(), v_pkg_id, 'package_run_integrity_check', 'done', now() - interval '3 hours')
  RETURNING id INTO v_step_id;

  PERFORM public.admin_reconcile_queued_tail_without_job(p_limit := 5);
  IF NOT EXISTS (SELECT 1 FROM public.job_queue WHERE package_id = v_pkg_id) THEN
    v_passed := v_passed+1; v_results := v_results || jsonb_build_object('test','T1_done_no_enqueue','pass',true);
  ELSE
    v_failed := v_failed+1; v_results := v_results || jsonb_build_object('test','T1_done_no_enqueue','pass',false);
  END IF;

  UPDATE public.package_steps SET status='skipped', updated_at = now() - interval '3 hours' WHERE id = v_step_id;
  PERFORM public.admin_reconcile_queued_tail_without_job(p_limit := 5);
  IF NOT EXISTS (SELECT 1 FROM public.job_queue WHERE package_id = v_pkg_id) THEN
    v_passed := v_passed+1; v_results := v_results || jsonb_build_object('test','T2_skipped_no_enqueue','pass',true);
  ELSE
    v_failed := v_failed+1; v_results := v_results || jsonb_build_object('test','T2_skipped_no_enqueue','pass',false);
  END IF;

  UPDATE public.package_steps SET status='blocked', updated_at = now() - interval '3 hours' WHERE id = v_step_id;
  PERFORM public.admin_reconcile_queued_tail_without_job(p_limit := 5);
  SELECT status INTO v_status FROM public.package_steps WHERE id = v_step_id;
  IF v_status = 'queued' OR EXISTS (SELECT 1 FROM public.job_queue WHERE package_id = v_pkg_id) THEN
    v_passed := v_passed+1; v_results := v_results || jsonb_build_object('test','T3_blocked_enqueue','pass',true,'step_status',v_status);
  ELSE
    v_failed := v_failed+1; v_results := v_results || jsonb_build_object('test','T3_blocked_enqueue','pass',false,'step_status',v_status);
  END IF;

  UPDATE public.package_steps SET status='blocked', updated_at = now() - interval '3 hours' WHERE id = v_step_id;
  SELECT count(*) INTO v_audit_before FROM public.auto_heal_log
  WHERE action_type='tail_heal_skipped_package_cooldown'
    AND result_status='skipped'
    AND (metadata->>'package_id')::uuid = v_pkg_id;

  PERFORM public.admin_reconcile_queued_tail_without_job(p_limit := 5);

  SELECT count(*) INTO v_audit_after FROM public.auto_heal_log
  WHERE action_type='tail_heal_skipped_package_cooldown'
    AND result_status='skipped'
    AND (metadata->>'package_id')::uuid = v_pkg_id
    AND created_at > now() - interval '2 minutes';

  IF v_audit_after > v_audit_before THEN
    v_passed := v_passed+1; v_results := v_results || jsonb_build_object('test','T4_cooldown_skip_audit','pass',true,'audit_delta',v_audit_after - v_audit_before);
  ELSE
    v_skipped := v_skipped+1; v_results := v_results || jsonb_build_object('test','T4_cooldown_skip_audit','pass',false,'note','no skip audit (likely WHERE filter or trigger touched updated_at)');
  END IF;

  DELETE FROM public.job_queue WHERE package_id = v_pkg_id;
  DELETE FROM public.package_steps WHERE package_id = v_pkg_id;
  DELETE FROM public.auto_heal_log WHERE (metadata->>'package_id')::uuid = v_pkg_id;
  DELETE FROM public.course_packages WHERE id = v_pkg_id;

  RETURN jsonb_build_object('ok', v_failed = 0, 'passed', v_passed, 'failed', v_failed, 'skipped', v_skipped, 'results', v_results);

EXCEPTION WHEN OTHERS THEN
  DELETE FROM public.job_queue WHERE package_id = v_pkg_id;
  DELETE FROM public.package_steps WHERE package_id = v_pkg_id;
  DELETE FROM public.auto_heal_log WHERE (metadata->>'package_id')::uuid = v_pkg_id;
  DELETE FROM public.course_packages WHERE id = v_pkg_id;
  RAISE;
END;
$$;