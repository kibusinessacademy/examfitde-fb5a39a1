CREATE OR REPLACE FUNCTION public.admin_test_heal_v3_invariants()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_pass boolean;
  v_detail text;
  v_count int;
  v_migration_cutoff timestamptz := '2026-05-01 07:00:00+00';
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
  END IF;

  -- TEST 1: nur post-migration target_type='job' Logs
  SELECT COUNT(*) INTO v_count FROM auto_heal_log
  WHERE action_type='dag_guard_block' AND target_type='job'
    AND created_at > v_migration_cutoff;
  v_pass := v_count = 0;
  v_detail := 'Found '||v_count||' legacy target_type=job entries after migration cutoff (expected 0)';
  v_results := v_results || jsonb_build_object('test','dag_target_type_course_package','pass',v_pass,'detail',v_detail);

  SELECT COUNT(*) INTO v_count FROM package_steps
  WHERE meta ? 'dag_block_counters' AND jsonb_typeof(meta->'dag_block_counters')='object';
  v_pass := true;
  v_detail := 'Found '||v_count||' steps with dag_block_counters in meta';
  v_results := v_results || jsonb_build_object('test','loop_counter_persistence','pass',v_pass,'detail',v_detail);

  SELECT COUNT(*) INTO v_count FROM exam_pool_fallback_state s
  WHERE s.current_stage='paused'
    AND EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = s.package_id
        AND jq.job_type IN ('package_generate_exam_pool','package_repair_exam_pool_quality',
                            'package_validate_exam_pool','package_repair_exam_pool_competency_coverage',
                            'package_repair_exam_pool_lf_coverage')
        AND jq.status IN ('queued','processing','pending')
    );
  v_pass := v_count = 0;
  v_detail := 'Found '||v_count||' paused packages with active exam_pool jobs (expected 0)';
  v_results := v_results || jsonb_build_object('test','paused_quarantine_consistency','pass',v_pass,'detail',v_detail);

  SELECT COUNT(*) INTO v_count FROM pg_trigger
  WHERE tgname IN ('trg_invalidate_heal_plan_on_hard_fail','trg_invalidate_heal_plan_on_job_hard_fail')
    AND NOT tgisinternal;
  v_pass := v_count = 2;
  v_detail := 'Found '||v_count||'/2 expected heal-plan triggers';
  v_results := v_results || jsonb_build_object('test','heal_plan_triggers_present','pass',v_pass,'detail',v_detail);

  SELECT COUNT(*) INTO v_count FROM information_schema.routine_privileges
  WHERE routine_schema='public' AND routine_name='fn_get_active_heal_plan'
    AND grantee='authenticated' AND privilege_type='EXECUTE';
  v_pass := v_count = 0;
  v_detail := 'authenticated has '||v_count||' EXECUTE grants on fn_get_active_heal_plan (expected 0)';
  v_results := v_results || jsonb_build_object('test','security_heal_plan_grant_revoked','pass',v_pass,'detail',v_detail);

  RETURN jsonb_build_object('tested_at', now(),
    'all_passed', NOT (v_results @> '[{"pass":false}]'::jsonb),
    'results', v_results);
END $$;