CREATE OR REPLACE FUNCTION public.admin_smoke_phantom_producer_guard_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pkg_id uuid;
  v_curr_id uuid;
  v_course_id uuid;
  v_step_id uuid;
  v_step_key text := 'generate_exam_pool';
  v_job_type text := 'package_generate_exam_pool';
  v_job_count int;
  v_audit_count int;
  v_test_label text;
  v_results jsonb := '[]'::jsonb;
  v_failures int := 0;
  v_passed int := 0;
  v_regress jsonb := jsonb_build_object('allow_regression', true, 'allow_regression_by', 'admin_manual');
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT id INTO v_curr_id FROM curricula LIMIT 1;
  SELECT id INTO v_course_id FROM courses LIMIT 1;
  IF v_curr_id IS NULL OR v_course_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no curricula or courses available for test');
  END IF;

  INSERT INTO course_packages(id, title, status, curriculum_id, course_id, package_key)
  VALUES (gen_random_uuid(), 'PHANTOM_GUARD_SMOKE', 'building', v_curr_id, v_course_id,
          'phantom_guard_smoke_'||substr(gen_random_uuid()::text,1,8))
  RETURNING id INTO v_pkg_id;

  -- A1: done <60s → SKIP
  INSERT INTO package_steps(id, package_id, step_key, status, finished_at, updated_at, meta)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'done'::step_status,
          now() - interval '5 seconds', now() - interval '5 seconds', '{"ok":"true"}'::jsonb)
  RETURNING id INTO v_step_id;
  UPDATE package_steps SET status='queued'::step_status, meta=meta || v_regress WHERE id=v_step_id;
  SELECT count(*) INTO v_job_count FROM job_queue WHERE package_id=v_pkg_id AND job_type=v_job_type;
  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_finalized_step' AND target_id=v_step_id::text;
  IF v_job_count=0 AND v_audit_count=1 THEN
    v_results := v_results || jsonb_build_object('test','A1_done_lt60s','pass',true);
    v_passed := v_passed + 1;
  ELSE
    v_results := v_results || jsonb_build_object('test','A1_done_lt60s','pass',false,'jobs',v_job_count,'audits',v_audit_count);
    v_failures := v_failures + 1;
  END IF;
  DELETE FROM package_steps WHERE id=v_step_id;

  -- A2: skipped <60s → SKIP
  INSERT INTO package_steps(id, package_id, step_key, status, updated_at, meta)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'skipped'::step_status, now() - interval '10 seconds', v_regress)
  RETURNING id INTO v_step_id;
  UPDATE package_steps SET status='queued'::step_status WHERE id=v_step_id;
  SELECT count(*) INTO v_job_count FROM job_queue WHERE package_id=v_pkg_id AND job_type=v_job_type;
  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_finalized_step' AND target_id=v_step_id::text;
  IF v_job_count=0 AND v_audit_count=1 THEN
    v_results := v_results || jsonb_build_object('test','A2_skipped_lt60s','pass',true);
    v_passed := v_passed + 1;
  ELSE
    v_results := v_results || jsonb_build_object('test','A2_skipped_lt60s','pass',false,'jobs',v_job_count,'audits',v_audit_count);
    v_failures := v_failures + 1;
  END IF;
  DELETE FROM package_steps WHERE id=v_step_id;

  -- A3: failed <60s → SKIP
  INSERT INTO package_steps(id, package_id, step_key, status, finished_at, updated_at, meta)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'failed'::step_status,
          now() - interval '20 seconds', now() - interval '20 seconds', v_regress)
  RETURNING id INTO v_step_id;
  UPDATE package_steps SET status='queued'::step_status WHERE id=v_step_id;
  SELECT count(*) INTO v_job_count FROM job_queue WHERE package_id=v_pkg_id AND job_type=v_job_type;
  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_finalized_step' AND target_id=v_step_id::text;
  IF v_job_count=0 AND v_audit_count=1 THEN
    v_results := v_results || jsonb_build_object('test','A3_failed_lt60s','pass',true);
    v_passed := v_passed + 1;
  ELSE
    v_results := v_results || jsonb_build_object('test','A3_failed_lt60s','pass',false,'jobs',v_job_count,'audits',v_audit_count);
    v_failures := v_failures + 1;
  END IF;
  DELETE FROM package_steps WHERE id=v_step_id;
  DELETE FROM job_queue WHERE package_id=v_pkg_id;

  -- A4 (negative): done >60s → Guard A NOT triggered
  INSERT INTO package_steps(id, package_id, step_key, status, finished_at, updated_at, meta)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'done'::step_status,
          now() - interval '5 minutes', now() - interval '5 minutes',
          '{"ok":"true"}'::jsonb || v_regress)
  RETURNING id INTO v_step_id;
  UPDATE package_steps SET status='queued'::step_status WHERE id=v_step_id;
  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_finalized_step' AND target_id=v_step_id::text;
  IF v_audit_count=0 THEN
    v_results := v_results || jsonb_build_object('test','A4_done_gt60s_negative','pass',true);
    v_passed := v_passed + 1;
  ELSE
    v_results := v_results || jsonb_build_object('test','A4_done_gt60s_negative','pass',false,'audits',v_audit_count);
    v_failures := v_failures + 1;
  END IF;
  DELETE FROM package_steps WHERE id=v_step_id;
  DELETE FROM job_queue WHERE package_id=v_pkg_id;

  -- Guard B subtests (fresh INSERT, no regression issue)
  FOR v_test_label IN SELECT unnest(ARRAY['queued','pending','processing','retry_scheduled']) LOOP
    INSERT INTO job_queue(job_type, payload, status, max_attempts, priority, package_id, created_at, updated_at)
    VALUES (v_job_type, jsonb_build_object('package_id', v_pkg_id, 'step_key', v_step_key),
            v_test_label, 8, 50, v_pkg_id, now() - interval '10 seconds', now() - interval '10 seconds');

    INSERT INTO package_steps(id, package_id, step_key, status)
    VALUES (gen_random_uuid(), v_pkg_id, v_step_key||'_b_'||v_test_label, 'queued'::step_status)
    RETURNING id INTO v_step_id;

    SELECT count(*) INTO v_audit_count FROM auto_heal_log
      WHERE action_type='atomic_enqueue_skipped_recent_duplicate' AND target_id=v_step_id::text;
    SELECT count(*) INTO v_job_count FROM job_queue
      WHERE package_id=v_pkg_id AND payload->>'step_key' = v_step_key||'_b_'||v_test_label;

    IF v_job_count=0 AND v_audit_count=1 THEN
      v_results := v_results || jsonb_build_object('test','B1_dup_'||v_test_label||'_lt60s','pass',true);
      v_passed := v_passed + 1;
    ELSE
      v_results := v_results || jsonb_build_object('test','B1_dup_'||v_test_label||'_lt60s','pass',false,'jobs',v_job_count,'audits',v_audit_count);
      v_failures := v_failures + 1;
    END IF;

    DELETE FROM job_queue WHERE package_id=v_pkg_id;
    DELETE FROM package_steps WHERE package_id=v_pkg_id;
  END LOOP;

  -- B2 (negative): dup >60s → Guard B NOT triggered
  INSERT INTO job_queue(job_type, payload, status, max_attempts, priority, package_id, created_at, updated_at)
  VALUES (v_job_type, jsonb_build_object('package_id', v_pkg_id, 'step_key', v_step_key),
          'queued', 8, 50, v_pkg_id, now() - interval '5 minutes', now() - interval '5 minutes');
  INSERT INTO package_steps(id, package_id, step_key, status)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key||'_b2_stale', 'queued'::step_status)
  RETURNING id INTO v_step_id;
  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_duplicate' AND target_id=v_step_id::text;
  IF v_audit_count=0 THEN
    v_results := v_results || jsonb_build_object('test','B2_dup_gt60s_negative','pass',true);
    v_passed := v_passed + 1;
  ELSE
    v_results := v_results || jsonb_build_object('test','B2_dup_gt60s_negative','pass',false,'audits',v_audit_count);
    v_failures := v_failures + 1;
  END IF;

  DELETE FROM course_pipeline_events WHERE package_id=v_pkg_id;
  DELETE FROM job_queue WHERE package_id=v_pkg_id;
  DELETE FROM package_steps WHERE package_id=v_pkg_id;
  DELETE FROM auto_heal_log WHERE metadata->>'package_id' = v_pkg_id::text;
  DELETE FROM course_packages WHERE id=v_pkg_id;

  INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('phantom_producer_guard_v1_smoke_run', 'system',
          CASE WHEN v_failures=0 THEN 'success' ELSE 'failure' END,
          jsonb_build_object('passed', v_passed, 'failed', v_failures, 'results', v_results));

  RETURN jsonb_build_object('ok', v_failures = 0, 'passed', v_passed, 'failed', v_failures, 'results', v_results);
END;
$$;