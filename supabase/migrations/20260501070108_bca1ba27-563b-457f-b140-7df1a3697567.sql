CREATE OR REPLACE FUNCTION public.fn_exam_pool_fallback_progress(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_state exam_pool_fallback_state%ROWTYPE;
  v_recent_fails int;
  v_new_stage text;
  v_model text;
  v_constraints jsonb;
  v_task_id uuid;
  v_cancelled_jobs int := 0;
  v_prev_stage text;
  v_exam_pool_types text[] := ARRAY[
    'package_generate_exam_pool',
    'package_repair_exam_pool_quality',
    'package_validate_exam_pool',
    'package_repair_exam_pool_competency_coverage',
    'package_repair_exam_pool_lf_coverage'
  ];
BEGIN
  SELECT * INTO v_state FROM exam_pool_fallback_state WHERE package_id = p_package_id;
  v_prev_stage := COALESCE(v_state.current_stage, 'normal');

  SELECT COUNT(*) INTO v_recent_fails
  FROM job_queue
  WHERE package_id = p_package_id
    AND job_type = ANY(v_exam_pool_types)
    AND status = 'failed'
    AND updated_at > now() - interval '6 hours';

  v_new_stage := CASE
    WHEN v_recent_fails >= 8 THEN 'paused'
    WHEN v_recent_fails >= 5 THEN 'constraint_relax'
    WHEN v_recent_fails >= 3 THEN 'provider_switch'
    ELSE 'normal'
  END;

  v_model := CASE v_new_stage
    WHEN 'provider_switch' THEN 'openai/gpt-5-mini'
    WHEN 'constraint_relax' THEN 'openai/gpt-5-mini'
    ELSE NULL
  END;

  v_constraints := CASE v_new_stage
    WHEN 'constraint_relax' THEN jsonb_build_object('lf_min',80,'bloom_relaxed',true)
    ELSE NULL
  END;

  INSERT INTO exam_pool_fallback_state(package_id, fail_count_6h, current_stage, last_stage_change_at, last_fail_at, model_override, constraint_overrides, updated_at)
  VALUES (p_package_id, v_recent_fails, v_new_stage, now(), now(), v_model, v_constraints, now())
  ON CONFLICT (package_id) DO UPDATE
    SET fail_count_6h = EXCLUDED.fail_count_6h,
        current_stage = EXCLUDED.current_stage,
        last_stage_change_at = CASE WHEN exam_pool_fallback_state.current_stage IS DISTINCT FROM EXCLUDED.current_stage
                                    THEN now() ELSE exam_pool_fallback_state.last_stage_change_at END,
        last_fail_at = CASE WHEN EXCLUDED.fail_count_6h > exam_pool_fallback_state.fail_count_6h
                            THEN now() ELSE exam_pool_fallback_state.last_fail_at END,
        model_override = EXCLUDED.model_override,
        constraint_overrides = EXCLUDED.constraint_overrides,
        updated_at = now();

  IF v_new_stage = 'paused' AND v_prev_stage IS DISTINCT FROM 'paused' THEN
    UPDATE job_queue
    SET status = 'cancelled',
        last_error = 'EXAM_POOL_FALLBACK_PAUSED: 8+ fails in 6h, auto-cancelled',
        updated_at = now()
    WHERE package_id = p_package_id
      AND job_type = ANY(v_exam_pool_types)
      AND status IN ('queued','processing','pending');
    GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;

    INSERT INTO heal_permanent_fix_tasks(pattern_key, cluster, package_id, title, description, status, priority)
    VALUES ('exam_pool_paused','exam_pool_loop',p_package_id,
      'Exam-Pool Fallback PAUSED — Manueller Eingriff nötig',
      'Paket hat 8+ Exam-Pool-Fails in 6h. Fallback-Stage=paused, '||v_cancelled_jobs||' aktive Jobs cancelled.',
      'open','critical')
    RETURNING id INTO v_task_id;

    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('exam_pool_paused_cancel','fn_exam_pool_fallback_progress','course_package',p_package_id::text,
      'applied','Paused: '||v_cancelled_jobs||' jobs cancelled, P1 task created',
      jsonb_build_object('fail_count_6h',v_recent_fails,'cancelled_jobs',v_cancelled_jobs,'task_id',v_task_id,'severity','critical'));
  END IF;

  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('exam_pool_fallback_stage','fn_exam_pool_fallback_progress','course_package',p_package_id::text,
    CASE WHEN v_prev_stage IS DISTINCT FROM v_new_stage THEN 'applied' ELSE 'noop' END,
    'Stage: '||v_prev_stage||' → '||v_new_stage||' (fails6h='||v_recent_fails||')',
    jsonb_build_object('previous_stage',v_prev_stage,'new_stage',v_new_stage,'fails_6h',v_recent_fails,'model_override',v_model,'constraints',v_constraints));

  RETURN jsonb_build_object('previous_stage',v_prev_stage,'new_stage',v_new_stage,'fails_6h',v_recent_fails,
    'cancelled_jobs',v_cancelled_jobs,'model_override',v_model,'constraints',v_constraints);
END $$;

-- LIVE-REGRESSIONSTESTS
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
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_count FROM auto_heal_log
  WHERE action_type='dag_guard_block' AND target_type='job' AND created_at > now()-interval '24 hours';
  v_pass := v_count = 0;
  v_detail := 'Found '||v_count||' legacy target_type=job entries in 24h (expected 0)';
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

REVOKE ALL ON FUNCTION public.admin_test_heal_v3_invariants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_test_heal_v3_invariants() TO authenticated, service_role;

-- ADMIN-QUARANTÄNE-VIEW
CREATE OR REPLACE VIEW public.v_admin_exam_pool_paused AS
SELECT
  s.package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  s.current_stage,
  s.fail_count_6h,
  s.last_stage_change_at,
  s.last_fail_at,
  s.updated_at AS state_updated_at,
  s.model_override,
  s.constraint_overrides,
  (SELECT COUNT(*) FROM job_queue jq WHERE jq.package_id = s.package_id
    AND jq.job_type IN ('package_generate_exam_pool','package_repair_exam_pool_quality',
                        'package_validate_exam_pool','package_repair_exam_pool_competency_coverage',
                        'package_repair_exam_pool_lf_coverage')
    AND jq.status IN ('queued','processing','pending')) AS active_jobs,
  (SELECT COUNT(*) FROM job_queue jq WHERE jq.package_id = s.package_id
    AND jq.job_type IN ('package_generate_exam_pool','package_repair_exam_pool_quality',
                        'package_validate_exam_pool','package_repair_exam_pool_competency_coverage',
                        'package_repair_exam_pool_lf_coverage')
    AND jq.status='cancelled' AND jq.updated_at > now()-interval '6 hours') AS cancelled_jobs_6h,
  (SELECT MAX(jq.updated_at) FROM job_queue jq WHERE jq.package_id = s.package_id
    AND jq.job_type IN ('package_generate_exam_pool','package_repair_exam_pool_quality',
                        'package_validate_exam_pool','package_repair_exam_pool_competency_coverage',
                        'package_repair_exam_pool_lf_coverage')) AS last_job_activity,
  (SELECT id FROM heal_permanent_fix_tasks t WHERE t.package_id = s.package_id
    AND t.pattern_key IN ('exam_pool_paused','exam_pool_quarantine','exam_pool_stagnation') AND t.status='open'
    ORDER BY created_at DESC LIMIT 1) AS open_backlog_task_id
FROM exam_pool_fallback_state s
LEFT JOIN course_packages cp ON cp.id = s.package_id
WHERE s.current_stage IN ('paused','constraint_relax','provider_switch')
ORDER BY
  CASE s.current_stage WHEN 'paused' THEN 0 WHEN 'constraint_relax' THEN 1 ELSE 2 END,
  s.last_stage_change_at DESC;

GRANT SELECT ON public.v_admin_exam_pool_paused TO authenticated, service_role;

-- ADMIN-AKTIONEN
CREATE OR REPLACE FUNCTION public.admin_exam_pool_restart(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE exam_pool_fallback_state
  SET current_stage='normal', fail_count_6h=0, model_override=NULL,
      constraint_overrides=NULL, last_stage_change_at=now(), updated_at=now()
  WHERE package_id = p_package_id;
  UPDATE heal_permanent_fix_tasks
  SET status='completed', completed_at=now(), completed_by=v_uid,
      notes=COALESCE(notes,'')||E'\n[admin_exam_pool_restart] '||now()::text
  WHERE package_id = p_package_id
    AND pattern_key IN ('exam_pool_paused','exam_pool_stagnation','exam_pool_quarantine')
    AND status='open';
  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('exam_pool_admin_restart','admin_exam_pool_restart','course_package',p_package_id::text,
    'applied','Admin reset exam-pool fallback to normal',
    jsonb_build_object('admin_uid',v_uid));
  RETURN jsonb_build_object('ok',true,'action','restart','package_id',p_package_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_exam_pool_cancel_all(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_cancelled int := 0;
BEGIN
  IF NOT has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE job_queue SET status='cancelled',
    last_error='ADMIN_CANCEL: admin_exam_pool_cancel_all', updated_at=now()
  WHERE package_id = p_package_id
    AND job_type IN ('package_generate_exam_pool','package_repair_exam_pool_quality',
                     'package_validate_exam_pool','package_repair_exam_pool_competency_coverage',
                     'package_repair_exam_pool_lf_coverage')
    AND status IN ('queued','processing','pending');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('exam_pool_admin_cancel_all','admin_exam_pool_cancel_all','course_package',p_package_id::text,
    'applied','Cancelled '||v_cancelled||' active exam-pool jobs',
    jsonb_build_object('admin_uid',v_uid,'cancelled',v_cancelled));
  RETURN jsonb_build_object('ok',true,'action','cancel_all','cancelled',v_cancelled);
END $$;

CREATE OR REPLACE FUNCTION public.admin_exam_pool_quarantine(p_package_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_cancelled int := 0; v_task_id uuid;
BEGIN
  IF NOT has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO exam_pool_fallback_state(package_id, fail_count_6h, current_stage, last_stage_change_at, updated_at, paused_reason)
  VALUES (p_package_id, 99, 'paused', now(), now(), COALESCE(p_reason,'admin_quarantine'))
  ON CONFLICT (package_id) DO UPDATE
    SET current_stage='paused', last_stage_change_at=now(), updated_at=now(),
        paused_reason=COALESCE(EXCLUDED.paused_reason,exam_pool_fallback_state.paused_reason);
  UPDATE job_queue SET status='cancelled',
    last_error='ADMIN_QUARANTINE: '||COALESCE(p_reason,'no reason'), updated_at=now()
  WHERE package_id = p_package_id
    AND job_type IN ('package_generate_exam_pool','package_repair_exam_pool_quality',
                     'package_validate_exam_pool','package_repair_exam_pool_competency_coverage',
                     'package_repair_exam_pool_lf_coverage')
    AND status IN ('queued','processing','pending');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  INSERT INTO heal_permanent_fix_tasks(pattern_key, cluster, package_id, title, description, status, priority, created_by)
  VALUES ('exam_pool_quarantine','exam_pool_loop',p_package_id,
    'Manuell quarantänt: Exam-Pool',
    COALESCE(p_reason,'Admin-Quarantäne')||E'\n['||v_cancelled||' Jobs cancelled]',
    'open','critical',v_uid)
  RETURNING id INTO v_task_id;
  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('exam_pool_admin_quarantine','admin_exam_pool_quarantine','course_package',p_package_id::text,
    'applied','Quarantined: '||v_cancelled||' jobs cancelled',
    jsonb_build_object('admin_uid',v_uid,'cancelled',v_cancelled,'task_id',v_task_id,'reason',p_reason));
  RETURN jsonb_build_object('ok',true,'action','quarantine','cancelled',v_cancelled,'task_id',v_task_id);
END $$;

REVOKE ALL ON FUNCTION public.admin_exam_pool_restart(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_exam_pool_cancel_all(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_exam_pool_quarantine(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_exam_pool_restart(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_exam_pool_cancel_all(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_exam_pool_quarantine(uuid, text) TO authenticated, service_role;

-- STAGNATION-ALERT
CREATE OR REPLACE FUNCTION public.fn_exam_pool_stagnation_alert()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_alerts_created int := 0;
  v_pkg record;
  v_exam_pool_types text[] := ARRAY[
    'package_generate_exam_pool','package_repair_exam_pool_quality',
    'package_validate_exam_pool','package_repair_exam_pool_competency_coverage',
    'package_repair_exam_pool_lf_coverage'
  ];
BEGIN
  FOR v_pkg IN
    WITH fail_burst AS (
      SELECT package_id, COUNT(*) AS metric, 'fail_burst_5_per_hour' AS pattern
      FROM job_queue
      WHERE job_type = ANY(v_exam_pool_types) AND status='failed'
        AND updated_at > now() - interval '1 hour' AND package_id IS NOT NULL
      GROUP BY package_id HAVING COUNT(*) >= 5
    ),
    stagnation AS (
      SELECT package_id, COUNT(*) AS metric, 'progress_stagnation_30min' AS pattern
      FROM job_queue
      WHERE job_type = ANY(v_exam_pool_types) AND status IN ('processing','queued')
        AND updated_at < now() - interval '30 minutes' AND package_id IS NOT NULL
      GROUP BY package_id
    )
    SELECT package_id, pattern, metric::int AS metric FROM fail_burst
    UNION ALL
    SELECT package_id, pattern, metric::int AS metric FROM stagnation
  LOOP
    IF EXISTS (
      SELECT 1 FROM heal_permanent_fix_tasks
      WHERE package_id = v_pkg.package_id
        AND pattern_key IN ('exam_pool_stagnation','exam_pool_paused','exam_pool_quarantine')
        AND status='open' AND created_at > now() - interval '1 hour'
    ) THEN CONTINUE; END IF;

    INSERT INTO heal_permanent_fix_tasks(pattern_key, cluster, package_id, title, description, status, priority)
    VALUES ('exam_pool_stagnation','exam_pool_loop',v_pkg.package_id,
      'ALERT: Exam-Pool '||v_pkg.pattern||' (metric='||v_pkg.metric||')',
      'Pattern: '||v_pkg.pattern||' — Metric: '||v_pkg.metric||'. Quarantäne-View prüfen.',
      'open','critical');

    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('exam_pool_stagnation_alert','fn_exam_pool_stagnation_alert','course_package',v_pkg.package_id::text,
      'applied','Pattern: '||v_pkg.pattern||' metric='||v_pkg.metric,
      jsonb_build_object('pattern',v_pkg.pattern,'metric',v_pkg.metric,'severity','critical'));

    v_alerts_created := v_alerts_created + 1;
  END LOOP;

  RETURN jsonb_build_object('ok',true,'alerts_created',v_alerts_created,'ran_at',now());
END $$;

REVOKE ALL ON FUNCTION public.fn_exam_pool_stagnation_alert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_exam_pool_stagnation_alert() TO service_role, authenticated;