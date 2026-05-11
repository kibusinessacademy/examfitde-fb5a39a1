CREATE OR REPLACE FUNCTION public.admin_smoke_tail_healer_coordination_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_id uuid; v_curr_id uuid; v_course_id uuid;
  v_results jsonb := '[]'::jsonb; v_passed int := 0; v_failures int := 0;
  v_count int; v_skip_audit_present boolean;
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
  VALUES (gen_random_uuid(), 'TAIL_HEAL_SMOKE', 'building', v_curr_id, v_course_id,
          'tail_heal_smoke_'||substr(gen_random_uuid()::text,1,8))
  RETURNING id INTO v_pkg_id;

  -- T1: done step >2h alt darf NICHT promoted werden
  INSERT INTO package_steps(id, package_id, step_key, status, finished_at, updated_at, meta)
  VALUES (gen_random_uuid(), v_pkg_id, 'run_integrity_check', 'done'::step_status,
          now() - interval '3 hours', now() - interval '3 hours',
          '{"ok":"true","executed":"true"}'::jsonb);
  PERFORM public.fn_detect_tail_step_enqueue_drift();
  PERFORM public.fn_detect_and_heal_tail_step_enqueue_drift_v2();
  SELECT count(*) INTO v_count FROM job_queue
    WHERE package_id=v_pkg_id AND job_type='package_run_integrity_check';
  v_results := v_results || jsonb_build_object('test','T1_done_not_promoted','pass', v_count=0,'jobs',v_count);
  IF v_count=0 THEN v_passed:=v_passed+1; ELSE v_failures:=v_failures+1; END IF;
  DELETE FROM job_queue WHERE package_id=v_pkg_id;
  DELETE FROM package_steps WHERE package_id=v_pkg_id;

  -- T2: skipped step >2h alt darf NICHT promoted werden
  INSERT INTO package_steps(id, package_id, step_key, status, finished_at, updated_at)
  VALUES (gen_random_uuid(), v_pkg_id, 'quality_council', 'skipped'::step_status,
          now() - interval '3 hours', now() - interval '3 hours');
  PERFORM public.fn_detect_tail_step_enqueue_drift();
  PERFORM public.fn_detect_and_heal_tail_step_enqueue_drift_v2();
  SELECT count(*) INTO v_count FROM job_queue
    WHERE package_id=v_pkg_id AND job_type='package_quality_council';
  v_results := v_results || jsonb_build_object('test','T2_skipped_not_promoted','pass', v_count=0,'jobs',v_count);
  IF v_count=0 THEN v_passed:=v_passed+1; ELSE v_failures:=v_failures+1; END IF;
  DELETE FROM job_queue WHERE package_id=v_pkg_id;
  DELETE FROM package_steps WHERE package_id=v_pkg_id;

  -- T3: blocked step >2h alt DARF promoted werden (Job + Audit success)
  INSERT INTO package_steps(id, package_id, step_key, status, updated_at)
  VALUES (gen_random_uuid(), v_pkg_id, 'auto_publish', 'blocked'::step_status,
          now() - interval '3 hours');
  PERFORM public.fn_detect_tail_step_enqueue_drift();
  SELECT count(*) INTO v_count FROM job_queue
    WHERE package_id=v_pkg_id AND job_type='package_auto_publish';
  v_results := v_results || jsonb_build_object('test','T3_blocked_promoted','pass', v_count=1,'jobs',v_count);
  IF v_count=1 THEN v_passed:=v_passed+1; ELSE v_failures:=v_failures+1; END IF;

  -- T4: zweiter Lauf <5min muss skipped werden (cooldown)
  UPDATE package_steps SET status='blocked'::step_status, updated_at=now() - interval '3 hours'
   WHERE package_id=v_pkg_id;
  DELETE FROM job_queue WHERE package_id=v_pkg_id;
  PERFORM public.fn_detect_tail_step_enqueue_drift();
  SELECT count(*) INTO v_count FROM job_queue
    WHERE package_id=v_pkg_id AND job_type='package_auto_publish';
  SELECT EXISTS(
    SELECT 1 FROM auto_heal_log
    WHERE action_type='tail_heal_skipped_package_cooldown'
      AND metadata->>'package_id' = v_pkg_id::text
      AND created_at > now() - interval '1 minute'
  ) INTO v_skip_audit_present;
  v_results := v_results || jsonb_build_object(
    'test','T4_second_run_cooldown_blocks',
    'pass', v_count=0 AND v_skip_audit_present,
    'jobs', v_count, 'skip_audit', v_skip_audit_present);
  IF v_count=0 AND v_skip_audit_present THEN v_passed:=v_passed+1; ELSE v_failures:=v_failures+1; END IF;

  -- Cleanup
  DELETE FROM job_queue WHERE package_id=v_pkg_id;
  DELETE FROM package_steps WHERE package_id=v_pkg_id;
  DELETE FROM auto_heal_log WHERE metadata->>'package_id' = v_pkg_id::text;
  DELETE FROM course_packages WHERE id=v_pkg_id;

  INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('tail_healer_coordination_smoke_v1','system',
          CASE WHEN v_failures=0 THEN 'success' ELSE 'failure' END,
          jsonb_build_object('passed',v_passed,'failed',v_failures,'results',v_results));
  RETURN jsonb_build_object('ok',v_failures=0,'passed',v_passed,'failed',v_failures,'results',v_results);

EXCEPTION WHEN OTHERS THEN
  IF v_pkg_id IS NOT NULL THEN
    BEGIN
      DELETE FROM job_queue WHERE package_id=v_pkg_id;
      DELETE FROM package_steps WHERE package_id=v_pkg_id;
      DELETE FROM auto_heal_log WHERE metadata->>'package_id' = v_pkg_id::text;
      DELETE FROM course_packages WHERE id=v_pkg_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('tail_healer_coordination_smoke_v1','system','failure',
          jsonb_build_object('error',SQLERRM,'sqlstate',SQLSTATE,
                             'package_id',v_pkg_id,'partial_results',v_results));
  RAISE;
END;
$function$;