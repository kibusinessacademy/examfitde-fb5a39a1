CREATE OR REPLACE FUNCTION public.admin_quality_gate_auto_heal_reproducer_probe(
  p_package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_admin boolean;
  v_is_service boolean;
  v_pkg record;
  v_classification jsonb;
  v_eligible boolean;
  v_plan jsonb;
  v_plan_count int;
  v_first_plan jsonb;
  v_planned_job_type text;
  v_would_attempt boolean := false;
  v_skipped_reason text := NULL;
  v_static_guard_predictions jsonb := '[]'::jsonb;
  v_result_status text;
  v_audit_meta jsonb;
  v_in_blocked_view boolean;
  v_minutes_since_report numeric;
BEGIN
  v_is_service := (current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role')
                  OR (current_user = 'service_role')
                  OR (current_user = 'postgres');
  IF NOT v_is_service THEN
    v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
    IF NOT COALESCE(v_is_admin, false) THEN
      RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT package_id, title, status, curriculum_id
  INTO v_pkg
  FROM public.course_packages
  WHERE package_id = p_package_id;

  IF v_pkg.package_id IS NULL THEN
    v_audit_meta := jsonb_build_object(
      'package_id', p_package_id, 'plan_count', 0, 'plan_entries', '[]'::jsonb,
      'would_attempt_insert', false, 'skipped_reason', 'package_not_found',
      'static_guard_predictions', '[]'::jsonb);
    INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
    VALUES ('quality_gate_auto_heal_reproducer_probe', 'no_plan',
            'course_package', p_package_id::text, v_audit_meta);
    RETURN v_audit_meta || jsonb_build_object('result_status','no_plan');
  END IF;

  SELECT true, minutes_since_report
  INTO v_in_blocked_view, v_minutes_since_report
  FROM public.v_quality_gate_blocked_packages
  WHERE package_id = p_package_id;
  v_in_blocked_view := COALESCE(v_in_blocked_view, false);

  v_classification := public.fn_classify_quality_gate_block(p_package_id);
  v_eligible := COALESCE((v_classification->'guards'->>'eligible_for_auto_heal')::boolean, false);
  v_plan := COALESCE(v_classification->'enqueue_plan', '[]'::jsonb);
  v_plan_count := COALESCE(jsonb_array_length(v_plan), 0);

  SELECT value INTO v_first_plan
  FROM jsonb_array_elements(v_plan) AS t(value)
  ORDER BY (value->>'priority')::int NULLS LAST
  LIMIT 1;
  v_planned_job_type := v_first_plan->>'job_type';

  IF NOT v_in_blocked_view THEN
    v_result_status := 'plan_branch_skipped';
    v_skipped_reason := 'not_in_v_quality_gate_blocked_packages';
  ELSIF COALESCE(v_minutes_since_report, 0) < 60 THEN
    v_result_status := 'plan_branch_skipped';
    v_skipped_reason := 'minutes_since_report_below_60';
  ELSIF NOT v_eligible THEN
    v_result_status := 'plan_branch_skipped';
    v_skipped_reason := 'guards_eligible_for_auto_heal_false';
  ELSIF v_plan_count = 0 OR v_first_plan IS NULL OR v_planned_job_type IS NULL THEN
    v_result_status := 'no_plan';
    v_skipped_reason := 'empty_enqueue_plan_would_log_healed_with_leaked_v_job_type';
  ELSE
    v_would_attempt := true;
    v_result_status := 'would_attempt_insert';

    SELECT jsonb_agg(jsonb_build_object(
      'trigger', t.tgname, 'function', p.proname,
      'likely_relevant', p.proname = ANY (ARRAY[
        'fn_guard_job_type_registry','fn_job_queue_ssot_validate','fn_guard_dag_prerequisites',
        'fn_guard_phantom_repair_enqueue','fn_guard_orphan_heal_requires_building',
        'fn_guard_non_building_enqueue_loop','fn_guard_redundant_content_step_enqueue',
        'fn_guard_redundant_seeding','fn_guard_autoheal_duplicate','fn_enforce_global_fanout_cap',
        'fn_guard_continuation_enqueue_cap','fn_guard_pool_fill_producer_cooldown',
        'fn_guard_integrity_enqueue_upstream','fn_debounce_exam_rebalance',
        'fn_guard_ssot_applicability','fn_guard_lease_expired_auto_clear','guard_job_payload',
        'fn_guard_bronze_lock_on_job_enqueue'])
    ) ORDER BY p.proname)
    INTO v_static_guard_predictions
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace nc ON nc.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE c.relname='job_queue' AND nc.nspname='public' AND NOT t.tgisinternal
      AND (t.tgtype & 2)::int = 2 AND (t.tgtype & 4)::int = 4 AND t.tgenabled <> 'D';
  END IF;

  v_audit_meta := jsonb_build_object(
    'package_id', p_package_id, 'package_title', v_pkg.title, 'package_status', v_pkg.status,
    'in_blocked_view', v_in_blocked_view, 'minutes_since_report', v_minutes_since_report,
    'eligible_for_auto_heal', v_eligible, 'plan_count', v_plan_count, 'plan_entries', v_plan,
    'first_plan_picked', v_first_plan, 'planned_job_type', v_planned_job_type,
    'would_attempt_insert', v_would_attempt, 'skipped_reason', v_skipped_reason,
    'static_guard_predictions', COALESCE(v_static_guard_predictions, '[]'::jsonb),
    'classification_guards', v_classification->'guards',
    'classification_metrics', v_classification->'metrics',
    'classification_failed_rules', v_classification->'failed_rules',
    'probe_constraint','strict_read_only_no_job_queue_no_package_steps_no_status_writes');

  INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
  VALUES ('quality_gate_auto_heal_reproducer_probe', v_result_status,
          'course_package', p_package_id::text, v_audit_meta);

  RETURN v_audit_meta || jsonb_build_object('result_status', v_result_status);
END;
$$;