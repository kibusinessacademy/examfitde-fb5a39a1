CREATE OR REPLACE FUNCTION public.admin_smoke_phantom_producer_guard_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_id uuid; v_curr_id uuid; v_course_id uuid; v_step_id uuid;
  v_step_key text := 'generate_exam_pool';
  v_job_type text := 'package_generate_exam_pool';
  v_job_count int; v_audit_count int; v_audit_before int; v_audit_delta int; v_test_label text;
  v_results jsonb := '[]'::jsonb; v_failures int := 0; v_passed int := 0; v_skipped int := 0;
  v_regress jsonb := jsonb_build_object('allow_regression', true, 'allow_regression_by', 'admin_manual');
  v_payload jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  SELECT id INTO v_curr_id FROM curricula LIMIT 1;
  SELECT id INTO v_course_id FROM courses LIMIT 1;
  IF v_curr_id IS NULL OR v_course_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no curricula or courses available');
  END IF;
  INSERT INTO course_packages(id, title, status, curriculum_id, course_id, package_key)
  VALUES (gen_random_uuid(), 'PHANTOM_GUARD_SMOKE', 'building', v_curr_id, v_course_id,
          'phantom_guard_smoke_'||substr(gen_random_uuid()::text,1,8))
  RETURNING id INTO v_pkg_id;

  v_payload := jsonb_build_object('package_id', v_pkg_id, 'step_key', v_step_key, 'curriculum_id', v_curr_id);

  -- A1
  INSERT INTO package_steps(id, package_id, step_key, status, finished_at, updated_at, meta)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'done'::step_status,
          now() - interval '5 seconds', now() - interval '5 seconds', '{"ok":"true"}'::jsonb)
  RETURNING id INTO v_step_id;
  UPDATE package_steps SET status='queued'::step_status, meta=meta || v_regress WHERE id=v_step_id;
  SELECT count(*) INTO v_job_count FROM job_queue WHERE package_id=v_pkg_id AND job_type=v_job_type;
  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_finalized_step' AND target_id=v_step_id::text;
  v_results := v_results || jsonb_build_object('test','A1_done_lt60s','pass', v_job_count=0 AND v_audit_count=1, 'jobs',v_job_count,'audits',v_audit_count);
  IF v_job_count=0 AND v_audit_count=1 THEN v_passed:=v_passed+1; ELSE v_failures:=v_failures+1; END IF;
  DELETE FROM package_steps WHERE id=v_step_id;

  -- A2
  INSERT INTO package_steps(id, package_id, step_key, status, updated_at, meta)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'skipped'::step_status, now() - interval '10 seconds', v_regress)
  RETURNING id INTO v_step_id;
  UPDATE package_steps SET status='queued'::step_status WHERE id=v_step_id;
  SELECT count(*) INTO v_job_count FROM job_queue WHERE package_id=v_pkg_id AND job_type=v_job_type;
  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_finalized_step' AND target_id=v_step_id::text;
  v_results := v_results || jsonb_build_object('test','A2_skipped_lt60s','pass', v_job_count=0 AND v_audit_count=1, 'jobs',v_job_count,'audits',v_audit_count);
  IF v_job_count=0 AND v_audit_count=1 THEN v_passed:=v_passed+1; ELSE v_failures:=v_failures+1; END IF;
  DELETE FROM package_steps WHERE id=v_step_id;

  -- A3
  INSERT INTO package_steps(id, package_id, step_key, status, finished_at, updated_at, meta)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'failed'::step_status,
          now() - interval '20 seconds', now() - interval '20 seconds', v_regress)
  RETURNING id INTO v_step_id;
  UPDATE package_steps SET status='queued'::step_status WHERE id=v_step_id;
  SELECT count(*) INTO v_job_count FROM job_queue WHERE package_id=v_pkg_id AND job_type=v_job_type;
  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_finalized_step' AND target_id=v_step_id::text;
  v_results := v_results || jsonb_build_object('test','A3_failed_lt60s','pass', v_job_count=0 AND v_audit_count=1, 'jobs',v_job_count,'audits',v_audit_count);
  IF v_job_count=0 AND v_audit_count=1 THEN v_passed:=v_passed+1; ELSE v_failures:=v_failures+1; END IF;
  DELETE FROM package_steps WHERE id=v_step_id;
  DELETE FROM job_queue WHERE package_id=v_pkg_id;

  -- A4 negative
  INSERT INTO package_steps(id, package_id, step_key, status, finished_at, updated_at, meta)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'done'::step_status,
          now() - interval '5 minutes', now() - interval '5 minutes', '{"ok":"true"}'::jsonb || v_regress)
  RETURNING id INTO v_step_id;
  UPDATE package_steps SET status='queued'::step_status WHERE id=v_step_id;
  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_finalized_step' AND target_id=v_step_id::text;
  v_results := v_results || jsonb_build_object('test','A4_done_gt60s_negative','pass', v_audit_count=0, 'audits',v_audit_count);
  IF v_audit_count=0 THEN v_passed:=v_passed+1; ELSE v_failures:=v_failures+1; END IF;
  DELETE FROM package_steps WHERE id=v_step_id;
  DELETE FROM job_queue WHERE package_id=v_pkg_id;

  -- B1: Duplicate-Guard für 4 Statuses. job_queue_status_enum-CHECK lässt nur
  -- pending/processing/completed/failed/cancelled zu — queued/retry_scheduled
  -- werden als 'skipped' markiert (nicht failure), Guard B ist über die anderen
  -- Statuses und Production-Audits abgedeckt.
  FOR v_test_label IN SELECT unnest(ARRAY['pending','processing','queued','retry_scheduled']) LOOP
    BEGIN
      INSERT INTO job_queue(job_type, payload, status, max_attempts, priority, package_id, created_at, updated_at)
      VALUES (v_job_type, v_payload, v_test_label, 8, 50, v_pkg_id,
              now() - interval '10 seconds', now() - interval '10 seconds');
    EXCEPTION WHEN check_violation THEN
      v_results := v_results || jsonb_build_object(
        'test','B1_dup_'||v_test_label||'_lt60s','pass', null, 'skipped', true,
        'reason', 'status not allowed by job_queue_status_enum CHECK');
      v_skipped := v_skipped + 1;
      CONTINUE;
    WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object(
        'test','B1_dup_'||v_test_label||'_lt60s','pass', false,
        'error', SQLERRM);
      v_failures := v_failures + 1;
      CONTINUE;
    END;

    SELECT count(*) INTO v_audit_before FROM auto_heal_log
      WHERE action_type='atomic_enqueue_skipped_recent_duplicate'
        AND metadata->>'package_id' = v_pkg_id::text;

    INSERT INTO package_steps(id, package_id, step_key, status, meta)
    VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'queued'::step_status, v_regress)
    RETURNING id INTO v_step_id;

    SELECT count(*) - v_audit_before INTO v_audit_delta FROM auto_heal_log
      WHERE action_type='atomic_enqueue_skipped_recent_duplicate'
        AND metadata->>'package_id' = v_pkg_id::text;
    SELECT count(*) INTO v_job_count FROM job_queue
      WHERE package_id=v_pkg_id AND job_type=v_job_type;

    v_results := v_results || jsonb_build_object(
      'test','B1_dup_'||v_test_label||'_lt60s',
      'pass', v_job_count=1 AND v_audit_delta=1,
      'jobs',v_job_count,'audit_delta',v_audit_delta);
    IF v_job_count=1 AND v_audit_delta=1 THEN v_passed:=v_passed+1; ELSE v_failures:=v_failures+1; END IF;
    DELETE FROM job_queue WHERE package_id=v_pkg_id;
    DELETE FROM package_steps WHERE package_id=v_pkg_id;
  END LOOP;

  -- B2 negative: stale duplicate >60s alt darf NICHT triggern.
  INSERT INTO job_queue(job_type, payload, status, max_attempts, priority, package_id, created_at, updated_at)
  VALUES (v_job_type, v_payload, 'pending', 8, 50, v_pkg_id,
          now() - interval '5 minutes', now() - interval '5 minutes');
  SELECT count(*) INTO v_audit_before FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_duplicate'
      AND metadata->>'package_id' = v_pkg_id::text;
  INSERT INTO package_steps(id, package_id, step_key, status, meta)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'queued'::step_status, v_regress)
  RETURNING id INTO v_step_id;
  SELECT count(*) - v_audit_before INTO v_audit_delta FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_duplicate'
      AND metadata->>'package_id' = v_pkg_id::text;
  v_results := v_results || jsonb_build_object('test','B2_dup_gt60s_negative','pass', v_audit_delta=0, 'audit_delta',v_audit_delta);
  IF v_audit_delta=0 THEN v_passed:=v_passed+1; ELSE v_failures:=v_failures+1; END IF;

  -- Cleanup
  DELETE FROM course_pipeline_events WHERE package_id=v_pkg_id;
  DELETE FROM job_queue WHERE package_id=v_pkg_id;
  DELETE FROM package_steps WHERE package_id=v_pkg_id;
  DELETE FROM auto_heal_log WHERE metadata->>'package_id' = v_pkg_id::text;
  DELETE FROM course_packages WHERE id=v_pkg_id;

  INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('phantom_producer_guard_v1_smoke_run', 'system',
          CASE WHEN v_failures=0 THEN 'success' ELSE 'failure' END,
          jsonb_build_object('passed', v_passed, 'failed', v_failures, 'skipped', v_skipped, 'results', v_results));
  RETURN jsonb_build_object('ok', v_failures = 0, 'passed', v_passed, 'failed', v_failures, 'skipped', v_skipped, 'results', v_results);

EXCEPTION WHEN OTHERS THEN
  IF v_pkg_id IS NOT NULL THEN
    BEGIN
      DELETE FROM course_pipeline_events WHERE package_id=v_pkg_id;
      DELETE FROM job_queue WHERE package_id=v_pkg_id;
      DELETE FROM package_steps WHERE package_id=v_pkg_id;
      DELETE FROM auto_heal_log WHERE metadata->>'package_id' = v_pkg_id::text;
      DELETE FROM course_packages WHERE id=v_pkg_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('phantom_producer_guard_v1_smoke_run', 'system', 'failure',
          jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE,
                             'package_id', v_pkg_id, 'partial_results', v_results,
                             'passed', v_passed, 'failed', v_failures, 'skipped', v_skipped));
  RAISE;
END;
$function$;