CREATE OR REPLACE FUNCTION public.fn_detect_and_heal_pipeline_step_drift_v3()
RETURNS TABLE(package_id uuid, step_key text, action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_recent int;
  v_eligible_steps text[] := ARRAY[
    'scaffold_learning_course','fanout_learning_content',
    'generate_handbook','validate_handbook','expand_handbook','enqueue_handbook_expand','validate_handbook_depth',
    'generate_glossary',
    'generate_learning_content','validate_learning_content','finalize_learning_content',
    'generate_lesson_minichecks','validate_lesson_minichecks',
    'auto_seed_exam_blueprints','generate_blueprint_variants','validate_blueprint_variants',
    'validate_blueprints','promote_blueprint_variants','generate_exam_pool','validate_exam_pool',
    'repair_exam_pool_quality',
    'generate_oral_exam','validate_oral_exam',
    'build_ai_tutor_index','validate_tutor_index',
    'elite_harden','run_integrity_check','quality_council','auto_publish'
  ];
BEGIN
  FOR r IN
    SELECT ps.package_id AS pid, ps.step_key AS skey
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status IN ('queued','pending_enqueue')
      AND ps.step_key = ANY(v_eligible_steps)
      AND cp.status IN ('building','queued')
      AND ps.updated_at < now() - interval '5 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.job_type = 'package_'||ps.step_key
          AND jq.status IN ('pending','processing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM step_dag_edges dag
        JOIN package_steps pps ON pps.package_id=ps.package_id AND pps.step_key=dag.depends_on
        WHERE dag.step_key = ps.step_key
          AND pps.status NOT IN ('done','skipped')
      )
    LIMIT 200
  LOOP
    SELECT COUNT(*) INTO v_recent FROM auto_heal_log
    WHERE action_type='pipeline_step_drift_v3_heal'
      AND target_id = r.pid::text
      AND metadata->>'step_key' = r.skey
      AND created_at > now() - interval '30 minutes';
    IF v_recent > 0 THEN CONTINUE; END IF;

    UPDATE package_steps
    SET meta = COALESCE(meta,'{}'::jsonb) - 'last_atomic_enqueue_at', updated_at=now()
    WHERE package_steps.package_id = r.pid AND package_steps.step_key = r.skey;

    UPDATE package_steps
    SET status='queued', updated_at=now() + interval '1 millisecond'
    WHERE package_steps.package_id = r.pid AND package_steps.step_key = r.skey 
      AND status IN ('queued','pending_enqueue');

    INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
    VALUES ('pipeline_step_drift_v3_heal','package',r.pid::text,'success',
      jsonb_build_object('step_key',r.skey,'reason','no_active_job_predecessors_done'));

    package_id := r.pid;
    step_key := r.skey;
    action := 'enqueue_triggered';
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Auch v2 patchen (gleicher Bug)
CREATE OR REPLACE FUNCTION public.fn_detect_and_heal_tail_step_enqueue_drift_v2()
RETURNS TABLE(package_id uuid, step_key text, action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_recent int;
BEGIN
  FOR r IN
    SELECT ps.package_id AS pid, ps.step_key AS skey
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status IN ('queued','pending_enqueue')
      AND ps.step_key IN ('run_integrity_check','quality_council','auto_publish','repair_exam_pool_quality','elite_harden','build_ai_tutor_index','validate_tutor_index')
      AND cp.status = 'building'
      AND ps.updated_at < now() - interval '5 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.job_type = 'package_'||ps.step_key
          AND jq.status IN ('pending','processing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM step_dag_edges dag
        JOIN package_steps pps ON pps.package_id=ps.package_id AND pps.step_key=dag.depends_on
        WHERE dag.step_key = ps.step_key
          AND pps.status NOT IN ('done','skipped')
      )
  LOOP
    SELECT COUNT(*) INTO v_recent FROM auto_heal_log
    WHERE action_type='tail_step_drift_v2_heal'
      AND target_id = r.pid::text
      AND metadata->>'step_key' = r.skey
      AND created_at > now() - interval '30 minutes';
    IF v_recent > 0 THEN CONTINUE; END IF;

    UPDATE package_steps
    SET meta = COALESCE(meta,'{}'::jsonb) - 'last_atomic_enqueue_at', updated_at=now()
    WHERE package_steps.package_id = r.pid AND package_steps.step_key = r.skey;

    UPDATE package_steps
    SET status='queued', updated_at=now() + interval '1 millisecond'
    WHERE package_steps.package_id = r.pid AND package_steps.step_key = r.skey 
      AND status IN ('queued','pending_enqueue');

    INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
    VALUES ('tail_step_drift_v2_heal','package',r.pid::text,'success',
      jsonb_build_object('step_key',r.skey,'reason','no_active_job_predecessors_done'));

    package_id := r.pid;
    step_key := r.skey;
    action := 'enqueue_triggered';
    RETURN NEXT;
  END LOOP;
END;
$$;