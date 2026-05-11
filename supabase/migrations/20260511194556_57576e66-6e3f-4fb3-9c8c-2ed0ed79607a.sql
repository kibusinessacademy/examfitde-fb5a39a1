-- 1. Helper: per-package cooldown check across both healer action_types
CREATE OR REPLACE FUNCTION public.fn_tail_heal_package_cooldown_active(
  p_package_id uuid,
  p_window interval DEFAULT interval '5 minutes'
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auto_heal_log l
    WHERE l.metadata->>'package_id' = p_package_id::text
      AND l.action_type IN (
        'queued_tail_reconciler_enqueue',
        'tail_step_drift_v2_heal',
        'tail_step_enqueue_drift_heal'
      )
      AND l.result_status = 'success'
      AND l.created_at > now() - p_window
  );
$$;

-- 2. Harden fn_detect_and_heal_tail_step_enqueue_drift_v2
CREATE OR REPLACE FUNCTION public.fn_detect_and_heal_tail_step_enqueue_drift_v2()
 RETURNS TABLE(package_id uuid, step_key text, action text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_recent int;
BEGIN
  FOR r IN
    SELECT ps.package_id AS pid, ps.step_key AS skey
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'blocked'  -- Fix #2: only truly stuck steps
      AND ps.step_key::text IN (
        'run_integrity_check','quality_council','auto_publish',
        'repair_exam_pool_quality','elite_harden',
        'build_ai_tutor_index','validate_tutor_index'
      )
      AND cp.status = 'building'
      AND ps.updated_at < now() - interval '5 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.job_type = 'package_'||ps.step_key::text
          AND jq.status IN ('pending','processing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM step_dag_edges dag
        JOIN package_steps pps ON pps.package_id=ps.package_id AND pps.step_key=dag.depends_on
        WHERE dag.step_key = ps.step_key
          AND pps.status NOT IN ('done','skipped')
      )
      AND NOT (
        ps.step_key::text = 'repair_exam_pool_quality'
        AND EXISTS (
          SELECT 1 FROM package_steps ps2
          WHERE ps2.package_id = ps.package_id
            AND ps2.step_key::text = 'generate_exam_pool'
            AND ps2.status IN ('done','skipped')
        )
      )
  LOOP
    -- Fix #2: per-package 5-min cooldown across all tail healers
    IF public.fn_tail_heal_package_cooldown_active(r.pid, interval '5 minutes') THEN
      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES ('tail_heal_skipped_package_cooldown','package', r.pid::text,'skipped',
              jsonb_build_object('package_id', r.pid, 'step_key', r.skey,
                                 'producer','tail_step_drift_v2_heal',
                                 'window','5 minutes'));
      CONTINUE;
    END IF;

    -- per-step 30-min idempotency (kept)
    SELECT COUNT(*) INTO v_recent FROM auto_heal_log
    WHERE action_type='tail_step_drift_v2_heal'
      AND target_id = r.pid::text
      AND metadata->>'step_key' = r.skey::text
      AND created_at > now() - interval '30 minutes';
    IF v_recent > 0 THEN CONTINUE; END IF;

    BEGIN
      UPDATE package_steps
      SET meta = COALESCE(meta,'{}'::jsonb) - 'last_atomic_enqueue_at', updated_at=now()
      WHERE package_steps.package_id = r.pid AND package_steps.step_key = r.skey;

      UPDATE package_steps
      SET status='queued', updated_at=now() + interval '1 millisecond'
      WHERE package_steps.package_id = r.pid AND package_steps.step_key = r.skey
        AND status = 'blocked';

      INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES ('tail_step_drift_v2_heal','package',r.pid::text,'success',
        jsonb_build_object('package_id', r.pid, 'step_key', r.skey,
                           'reason','blocked_no_active_job_predecessors_done'));

      package_id := r.pid; step_key := r.skey::text; action := 'enqueue_triggered';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES ('tail_step_drift_v2_heal','package',r.pid::text,'error',
        jsonb_build_object('package_id', r.pid, 'step_key', r.skey,
                           'error',SQLERRM,'sqlstate',SQLSTATE));
      package_id := r.pid; step_key := r.skey::text; action := 'error';
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$;

-- 3. Harden fn_detect_tail_step_enqueue_drift (the v1 producer)
CREATE OR REPLACE FUNCTION public.fn_detect_tail_step_enqueue_drift()
 RETURNS TABLE(package_id uuid, step_key text, action text, job_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec record; v_job_id uuid;
  v_total int := 0; v_healed int := 0; v_skipped int := 0; v_blocked int := 0;
BEGIN
  FOR v_rec IN
    SELECT ps.package_id, ps.step_key, ps.updated_at, cp.status AS pkg_status,
           EXTRACT(EPOCH FROM (now() - ps.updated_at))/3600 AS hrs_stuck
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'blocked'  -- Fix #2: only blocked, not 'queued'
      AND ps.updated_at < now() - interval '2 hours'
      AND cp.status = 'building'
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.payload->>'package_id' = ps.package_id::text
          AND jq.job_type = 'package_' || ps.step_key
          AND jq.status IN ('pending','processing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM step_dag_edges dag
        JOIN package_steps ps2 ON ps2.package_id=ps.package_id AND ps2.step_key=dag.depends_on
        WHERE dag.step_key = ps.step_key AND ps2.status NOT IN ('done','skipped')
      )
    ORDER BY ps.updated_at ASC
    LIMIT 50
  LOOP
    -- Block-awareness (kept)
    IF public.fn_is_package_progress_blocked(v_rec.package_id) THEN
      v_blocked := v_blocked + 1;
      PERFORM public.fn_log_auto_heal_blocked_skip(
        v_rec.package_id, 'tail_step_enqueue_drift_heal', v_rec.step_key, 'package_progress_blocked'
      );
      CONTINUE;
    END IF;

    -- Fix #2: per-package 5-min cooldown across all tail healers
    IF public.fn_tail_heal_package_cooldown_active(v_rec.package_id, interval '5 minutes') THEN
      v_skipped := v_skipped + 1;
      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES ('tail_heal_skipped_package_cooldown','package', v_rec.package_id::text,'skipped',
              jsonb_build_object('package_id', v_rec.package_id, 'step_key', v_rec.step_key,
                                 'producer','tail_step_enqueue_drift_heal','window','5 minutes'));
      CONTINUE;
    END IF;

    -- per-step 30-min idempotency (kept)
    IF public.fn_auto_heal_package_cooldown_active(
      v_rec.package_id, 'tail_step_enqueue_drift_heal', interval '30 minutes'
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_total := v_total + 1;
    BEGIN
      INSERT INTO job_queue (
        job_type, payload, status, priority, created_at, run_after,
        job_name, correlation_id
      ) VALUES (
        'package_' || v_rec.step_key,
        jsonb_build_object('package_id', v_rec.package_id, 'source', 'tail_step_drift_heal',
                           'enqueue_source', 'tail_step_drift_heal'),
        'pending', 50, now(), now(),
        'tail_drift_heal:' || v_rec.step_key || ':' || v_rec.package_id::text,
        gen_random_uuid()
      ) RETURNING id INTO v_job_id;

      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('tail_step_enqueue_drift_heal','package', v_rec.package_id::text, 'success',
        jsonb_build_object('package_id', v_rec.package_id, 'step_key', v_rec.step_key,
                           'job_id', v_job_id,
                           'hrs_stuck', round(v_rec.hrs_stuck::numeric, 1),
                           'pkg_status', v_rec.pkg_status));
      v_healed := v_healed + 1;
      package_id := v_rec.package_id; step_key := v_rec.step_key;
      action := 'enqueued'; job_id := v_job_id; RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('tail_step_enqueue_drift_heal','package', v_rec.package_id::text, 'failed',
              jsonb_build_object('package_id', v_rec.package_id, 'step_key', v_rec.step_key, 'error', SQLERRM));
    END;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('tail_step_enqueue_drift_run','system',
          CASE WHEN v_total=0 AND v_blocked=0 THEN 'noop' ELSE 'success' END,
          jsonb_build_object('total', v_total, 'healed', v_healed,
                             'skipped', v_skipped, 'blocked', v_blocked));
END;
$function$;

-- 4. View: only show packages with BLOCKED tail steps (drop+create wegen column-rename Risiko: wir behalten Spalten, nur next_tail_step-Quelle wechselt)
CREATE OR REPLACE VIEW public.v_queued_tail_without_job AS
SELECT id AS package_id,
    package_key,
    curriculum_id,
    track,
    ( SELECT count(*) AS count
           FROM exam_questions eq
          WHERE eq.package_id = cp.id AND eq.status = 'approved'::question_status) AS approved_q,
    COALESCE(((feature_flags -> 'bronze'::text) ->> 'requires_review'::text)::boolean, false) AS bronze_review,
    COALESCE(((feature_flags -> 'bronze'::text) ->> 'manual_bypass'::text)::boolean, false) AS bronze_bypass,
    ( SELECT s.step_key
           FROM ( SELECT ps.step_key,
                        CASE ps.step_key
                            WHEN 'run_integrity_check'::text THEN 1
                            WHEN 'quality_council'::text THEN 2
                            WHEN 'auto_publish'::text THEN 3
                            ELSE NULL::integer
                        END AS ord
                   FROM package_steps ps
                  WHERE ps.package_id = cp.id
                    AND (ps.step_key = ANY (ARRAY['run_integrity_check'::text, 'quality_council'::text, 'auto_publish'::text]))
                    AND ps.status::text = 'blocked'::text  -- Fix #2
                ) s
          ORDER BY s.ord
         LIMIT 1) AS next_tail_step,
        CASE
            WHEN COALESCE(((feature_flags -> 'bronze'::text) ->> 'requires_review'::text)::boolean, false) = true
             AND COALESCE(((feature_flags -> 'bronze'::text) ->> 'manual_bypass'::text)::boolean, false) = false THEN 'BRONZE_REVIEW_TERMINAL'::text
            ELSE 'ELIGIBLE'::text
        END AS reconciler_verdict
   FROM course_packages cp
  WHERE status = 'building'::text
    AND COALESCE(archived, false) = false
    AND NOT (EXISTS ( SELECT 1
           FROM job_queue j
          WHERE j.package_id = cp.id
            AND (j.status = ANY (ARRAY['pending'::text, 'processing'::text, 'queued'::text, 'retry_scheduled'::text, 'batch_pending'::text]))))
    AND (EXISTS ( SELECT 1
           FROM package_steps ps
          WHERE ps.package_id = cp.id
            AND (ps.step_key = ANY (ARRAY['run_integrity_check'::text, 'quality_council'::text, 'auto_publish'::text]))
            AND ps.status::text = 'blocked'::text));  -- Fix #2

-- 5. Harden admin_reconcile_queued_tail_without_job with cooldown
CREATE OR REPLACE FUNCTION public.admin_reconcile_queued_tail_without_job(p_dry_run boolean DEFAULT true, p_limit integer DEFAULT 50)
 RETURNS TABLE(package_id uuid, package_key text, next_tail_step text, action_taken text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller UUID := auth.uid();
  v_is_admin BOOLEAN;
  rec RECORD;
  v_enq_count INT := 0;
  v_skipped_count INT := 0;
  v_cooldown_count INT := 0;
BEGIN
  IF v_caller IS NULL THEN
    v_is_admin := true;
  ELSE
    SELECT has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'forbidden: admin role required';
    END IF;
  END IF;

  FOR rec IN
    SELECT v.package_id, v.package_key, v.curriculum_id, v.next_tail_step, v.bronze_bypass
    FROM v_queued_tail_without_job v
    WHERE v.reconciler_verdict='ELIGIBLE'
      AND v.next_tail_step IS NOT NULL
    ORDER BY v.approved_q DESC
    LIMIT p_limit
  LOOP
    -- Fix #2: per-package 5-min cooldown
    IF NOT p_dry_run AND public.fn_tail_heal_package_cooldown_active(rec.package_id, interval '5 minutes') THEN
      v_cooldown_count := v_cooldown_count + 1;
      INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, metadata)
      VALUES (rec.package_id::text, 'package', 'tail_heal_skipped_package_cooldown', 'skipped',
              jsonb_build_object('package_id', rec.package_id,
                                 'producer','queued_tail_reconciler_enqueue',
                                 'step_key', rec.next_tail_step, 'window','5 minutes'));
      package_id := rec.package_id;
      package_key := rec.package_key;
      next_tail_step := rec.next_tail_step;
      action_taken := 'SKIPPED:cooldown_5min';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      package_id := rec.package_id;
      package_key := rec.package_key;
      next_tail_step := rec.next_tail_step;
      action_taken := 'DRY_RUN_WOULD_ENQUEUE';
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO job_queue (job_type, status, package_id, payload, priority, worker_pool, job_name)
      VALUES (
        'package_' || rec.next_tail_step,
        'pending',
        rec.package_id,
        jsonb_build_object(
          'package_id', rec.package_id,
          'curriculum_id', rec.curriculum_id,
          'enqueue_source', 'queued_tail_reconciler_v1',
          'step_key', rec.next_tail_step,
          'bronze_lock_override', rec.bronze_bypass
        ),
        5, 'core', 'package_' || rec.next_tail_step
      );

      INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, metadata)
      VALUES (rec.package_id::text, 'package', 'queued_tail_reconciler_enqueue', 'success',
              jsonb_build_object('package_id', rec.package_id,
                                 'step_key', rec.next_tail_step, 'package_key', rec.package_key,
                                 'bronze_bypass', rec.bronze_bypass));
      v_enq_count := v_enq_count + 1;

      package_id := rec.package_id;
      package_key := rec.package_key;
      next_tail_step := rec.next_tail_step;
      action_taken := 'ENQUEUED';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, error_message, metadata)
      VALUES (rec.package_id::text, 'package', 'queued_tail_reconciler_enqueue_error', 'failed', SQLERRM,
              jsonb_build_object('package_id', rec.package_id, 'step_key', rec.next_tail_step));
      v_skipped_count := v_skipped_count + 1;

      package_id := rec.package_id;
      package_key := rec.package_key;
      next_tail_step := rec.next_tail_step;
      action_taken := 'SKIPPED:' || SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;

  INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, metadata)
  VALUES (NULL, 'system', 'queued_tail_reconciler_run_summary', 'success',
          jsonb_build_object('dry_run', p_dry_run, 'enqueued', v_enq_count,
                             'errored', v_skipped_count, 'cooldown_skipped', v_cooldown_count));
END;
$function$;

-- 6. Smoke RPC
CREATE OR REPLACE FUNCTION public.admin_smoke_tail_healer_coordination_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_id uuid; v_curr_id uuid; v_course_id uuid;
  v_results jsonb := '[]'::jsonb; v_passed int := 0; v_failures int := 0;
  v_count int;
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
  INSERT INTO package_steps(id, package_id, step_key, status, finished_at, updated_at)
  VALUES (gen_random_uuid(), v_pkg_id, 'run_integrity_check', 'done'::step_status,
          now() - interval '3 hours', now() - interval '3 hours');
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
  -- step erneut blocked machen, ohne Audit zu löschen
  UPDATE package_steps SET status='blocked'::step_status, updated_at=now() - interval '3 hours'
   WHERE package_id=v_pkg_id;
  DELETE FROM job_queue WHERE package_id=v_pkg_id;
  PERFORM public.fn_detect_tail_step_enqueue_drift();
  SELECT count(*) INTO v_count FROM job_queue
    WHERE package_id=v_pkg_id AND job_type='package_auto_publish';
  -- Skip-Audit-Eintrag erwartet
  v_results := v_results || jsonb_build_object(
    'test','T4_second_run_cooldown_blocks',
    'pass', v_count=0 AND EXISTS(
      SELECT 1 FROM auto_heal_log
      WHERE action_type='tail_heal_skipped_package_cooldown'
        AND metadata->>'package_id' = v_pkg_id::text
        AND created_at > now() - interval '1 minute'
    ),
    'jobs', v_count);
  IF v_count=0 THEN v_passed:=v_passed+1; ELSE v_failures:=v_failures+1; END IF;

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

GRANT EXECUTE ON FUNCTION public.admin_smoke_tail_healer_coordination_v1() TO authenticated, service_role, anon;

-- Audit installation
INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
VALUES ('tail_healer_coordination_v1_installed','system','success',
        jsonb_build_object('migration','fix_2_tail_healer_coordination_v1',
                           'changes', jsonb_build_array(
                             'fn_detect_and_heal_tail_step_enqueue_drift_v2: status=blocked + 5min cooldown',
                             'fn_detect_tail_step_enqueue_drift: status=blocked + 5min cooldown',
                             'admin_reconcile_queued_tail_without_job: 5min cooldown',
                             'v_queued_tail_without_job: filter status=blocked',
                             'fn_tail_heal_package_cooldown_active helper',
                             'admin_smoke_tail_healer_coordination_v1 smoke RPC'
                           )));