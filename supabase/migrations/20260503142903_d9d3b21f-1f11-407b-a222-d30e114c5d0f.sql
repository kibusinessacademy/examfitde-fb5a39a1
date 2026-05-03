
-- ============================================================
-- F1+F2+F3: Heiler-Schema-Drift + Phantom-Repair + Recursion-Boundary
-- ============================================================

-- F1: admin_heal_step_job_coupling_v4 → 'completed' Enum-Drift entfernen
CREATE OR REPLACE FUNCTION public.admin_heal_step_job_coupling_v4(_step_keys text[] DEFAULT ARRAY['scaffold_learning_course'::text, 'generate_glossary'::text, 'fanout_learning_content'::text, 'generate_learning_content'::text, 'finalize_learning_content'::text, 'validate_learning_content'::text, 'auto_seed_exam_blueprints'::text, 'validate_blueprints'::text, 'generate_blueprint_variants'::text, 'validate_blueprint_variants'::text, 'promote_blueprint_variants'::text, 'generate_exam_pool'::text, 'validate_exam_pool'::text, 'repair_exam_pool_quality'::text, 'build_ai_tutor_index'::text, 'validate_tutor_index'::text, 'generate_oral_exam'::text, 'validate_oral_exam'::text, 'generate_lesson_minichecks'::text, 'validate_lesson_minichecks'::text, 'generate_handbook'::text, 'validate_handbook'::text, 'enqueue_handbook_expand'::text, 'expand_handbook'::text, 'validate_handbook_depth'::text, 'elite_harden'::text, 'run_integrity_check'::text, 'quality_council'::text, 'auto_publish'::text])
 RETURNS TABLE(package_id uuid, step_key text, action text, job_id uuid, err text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  new_job_id uuid;
  v_predecessors_ok boolean;
  v_cancel_loop_count int;
  v_skip_reason text;
  v_predmap jsonb := jsonb_build_object(
    'auto_seed_exam_blueprints', jsonb_build_array('scaffold_learning_course'),
    'validate_blueprints', jsonb_build_array('auto_seed_exam_blueprints'),
    'generate_blueprint_variants', jsonb_build_array('validate_blueprints'),
    'validate_blueprint_variants', jsonb_build_array('generate_blueprint_variants'),
    'promote_blueprint_variants', jsonb_build_array('validate_blueprint_variants'),
    'generate_exam_pool', jsonb_build_array('validate_blueprints'),
    'validate_exam_pool', jsonb_build_array('generate_exam_pool'),
    'repair_exam_pool_quality', jsonb_build_array('validate_exam_pool'),
    'build_ai_tutor_index', jsonb_build_array('finalize_learning_content'),
    'validate_tutor_index', jsonb_build_array('build_ai_tutor_index'),
    'generate_oral_exam', jsonb_build_array('validate_exam_pool'),
    'validate_oral_exam', jsonb_build_array('generate_oral_exam'),
    'generate_lesson_minichecks', jsonb_build_array('finalize_learning_content'),
    'validate_lesson_minichecks', jsonb_build_array('generate_lesson_minichecks'),
    'generate_handbook', jsonb_build_array('finalize_learning_content'),
    'validate_handbook', jsonb_build_array('generate_handbook'),
    'enqueue_handbook_expand', jsonb_build_array('validate_handbook'),
    'expand_handbook', jsonb_build_array('enqueue_handbook_expand'),
    'validate_handbook_depth', jsonb_build_array('expand_handbook'),
    'elite_harden', jsonb_build_array('validate_exam_pool'),
    'run_integrity_check', jsonb_build_array('elite_harden'),
    'quality_council', jsonb_build_array('run_integrity_check'),
    'auto_publish', jsonb_build_array('quality_council')
  );
BEGIN
  FOR r IN
    SELECT DISTINCT
      ps.package_id AS pkg_id,
      ps.step_key::text AS step_key_t,
      cp.curriculum_id AS curr_id,
      ps.id AS step_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'
      AND ps.step_key::text = ANY(_step_keys)
      AND cp.status = 'building'
      AND cp.curriculum_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.job_type = 'package_' || ps.step_key::text
          AND jq.status IN ('pending','queued','processing','running','batch_pending')
      )
  LOOP
    v_skip_reason := NULL;
    v_predecessors_ok := TRUE;

    -- F1 FIX: 'completed' aus IN-Liste entfernt — kein gültiger step_status enum.
    IF v_predmap ? r.step_key_t THEN
      SELECT NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_predmap->r.step_key_t) AS pred(key)
        WHERE NOT EXISTS (
          SELECT 1 FROM package_steps ps2
          WHERE ps2.package_id = r.pkg_id
            AND ps2.step_key::text = pred.key
            AND ps2.status IN ('done', 'skipped')
        )
      ) INTO v_predecessors_ok;

      IF NOT v_predecessors_ok THEN
        v_skip_reason := 'PREDECESSORS_NOT_DONE';
      END IF;
    END IF;

    IF v_skip_reason IS NULL THEN
      SELECT COUNT(*) INTO v_cancel_loop_count
      FROM job_queue
      WHERE package_id = r.pkg_id
        AND job_type = 'package_' || r.step_key_t
        AND status = 'cancelled'
        AND updated_at > now() - interval '1 hour';
      IF v_cancel_loop_count >= 3 THEN
        v_skip_reason := 'CANCEL_COOLDOWN';
      END IF;
    END IF;

    -- F2-Schutz auch hier: kein Repair enqueuen, wenn generate_exam_pool done/skipped
    IF v_skip_reason IS NULL AND r.step_key_t = 'repair_exam_pool_quality' THEN
      IF EXISTS (
        SELECT 1 FROM package_steps ps3
        WHERE ps3.package_id = r.pkg_id
          AND ps3.step_key::text = 'generate_exam_pool'
          AND ps3.status IN ('done','skipped')
      ) THEN
        v_skip_reason := 'PHANTOM_REPAIR_TARGET_DONE';
      END IF;
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      package_id := r.pkg_id; step_key := r.step_key_t;
      action := 'skipped'; job_id := NULL; err := v_skip_reason;
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO job_queue(job_type, package_id, payload, status, priority, worker_pool)
      VALUES (
        'package_' || r.step_key_t,
        r.pkg_id,
        jsonb_build_object('package_id', r.pkg_id, 'curriculum_id', r.curr_id, 'step_key', r.step_key_t),
        'pending',
        100,
        COALESCE((SELECT worker_pool FROM job_type_policies WHERE job_type = 'package_' || r.step_key_t), 'default')
      )
      RETURNING id INTO new_job_id;

      package_id := r.pkg_id; step_key := r.step_key_t;
      action := 'enqueued'; job_id := new_job_id; err := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      package_id := r.pkg_id; step_key := r.step_key_t;
      action := 'enqueue_failed'; job_id := NULL; err := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$;

-- F2a: pipeline_step_drift_v3 → repair_exam_pool_quality wenn target done/skipped ausschließen
CREATE OR REPLACE FUNCTION public.fn_detect_and_heal_pipeline_step_drift_v3()
 RETURNS TABLE(package_id uuid, step_key text, action text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND ps.step_key::text = ANY(v_eligible_steps)
      AND cp.status IN ('building','queued')
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
      -- F2 FIX: kein Phantom-Repair
      AND NOT (
        ps.step_key::text = 'repair_exam_pool_quality'
        AND EXISTS (
          SELECT 1 FROM package_steps ps2
          WHERE ps2.package_id = ps.package_id
            AND ps2.step_key::text = 'generate_exam_pool'
            AND ps2.status IN ('done','skipped')
        )
      )
    LIMIT 200
  LOOP
    SELECT COUNT(*) INTO v_recent FROM auto_heal_log
    WHERE action_type='pipeline_step_drift_v3_heal'
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
        AND status IN ('queued','pending_enqueue');

      INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES ('pipeline_step_drift_v3_heal','package',r.pid::text,'success',
        jsonb_build_object('step_key',r.skey,'reason','no_active_job_predecessors_done'));

      package_id := r.pid; step_key := r.skey::text; action := 'enqueue_triggered';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES ('pipeline_step_drift_v3_heal','package',r.pid::text,'error',
        jsonb_build_object('step_key',r.skey,'error',SQLERRM,'sqlstate',SQLSTATE));
      package_id := r.pid; step_key := r.skey::text; action := 'error';
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$;

-- F2b: tail_step_drift_v2 → identische Phantom-Repair-Exklusion + Per-Row-Boundary
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
    WHERE ps.status IN ('queued','pending_enqueue')
      AND ps.step_key::text IN ('run_integrity_check','quality_council','auto_publish','repair_exam_pool_quality','elite_harden','build_ai_tutor_index','validate_tutor_index')
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
        AND status IN ('queued','pending_enqueue');

      INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES ('tail_step_drift_v2_heal','package',r.pid::text,'success',
        jsonb_build_object('step_key',r.skey,'reason','no_active_job_predecessors_done'));

      package_id := r.pid; step_key := r.skey::text; action := 'enqueue_triggered';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES ('tail_step_drift_v2_heal','package',r.pid::text,'error',
        jsonb_build_object('step_key',r.skey,'error',SQLERRM,'sqlstate',SQLSTATE));
      package_id := r.pid; step_key := r.skey::text; action := 'error';
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$;

-- F3: fn_resolve_pending_enqueue_steps → Drei-Phasen + Per-Row-Boundary
CREATE OR REPLACE FUNCTION public.fn_resolve_pending_enqueue_steps()
 RETURNS TABLE(out_package_id uuid, out_step_key text, out_action text, out_detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec record;
  v_job_type text;
  v_existing_job_count int;
  v_enqueue_result record;
  v_current_status text;
  v_candidate_keys jsonb := '[]'::jsonb;
BEGIN
  -- Phase 1: Kandidaten sammeln (snapshot) — keine Mutation
  FOR rec IN
    SELECT ps.package_id, ps.step_key::text AS step_key, ps.attempts, ps.last_error,
           cp.curriculum_id, cp.status::text AS pkg_status
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'pending_enqueue'::step_status
      AND ps.updated_at < now() - interval '2 minutes'
      AND cp.status IN ('building','quality_gate_failed')
  LOOP
    -- Phase 2: Per-Row in eigener Boundary, mit Re-Read+FOR UPDATE
    BEGIN
      -- Re-Read: hat Trigger den Step inzwischen weiterbewegt?
      SELECT status::text INTO v_current_status
      FROM package_steps
      WHERE package_id = rec.package_id AND step_key = rec.step_key
      FOR UPDATE;

      IF v_current_status IS NULL OR v_current_status <> 'pending_enqueue' THEN
        out_package_id := rec.package_id; out_step_key := rec.step_key;
        out_action := 'skipped_already_progressed_by_trigger';
        out_detail := v_current_status;
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF COALESCE(rec.attempts, 0) >= 3 THEN
        UPDATE package_steps SET status = 'failed'::step_status,
          last_error = COALESCE(last_error,'') || ' | exhausted 3 enqueue retries',
          finished_at = now()
        WHERE package_id = rec.package_id AND step_key = rec.step_key;
        out_package_id := rec.package_id; out_step_key := rec.step_key;
        out_action := 'failed_exhausted'; out_detail := rec.last_error;
        RETURN NEXT;
        CONTINUE;
      END IF;

      SELECT sjm.job_types[1] INTO v_job_type
      FROM step_job_mapping sjm
      WHERE sjm.step_key = rec.step_key AND array_length(sjm.job_types,1) > 0;

      IF v_job_type IS NULL THEN
        out_package_id := rec.package_id; out_step_key := rec.step_key;
        out_action := 'skip_no_mapping'; out_detail := NULL;
        RETURN NEXT;
        CONTINUE;
      END IF;

      SELECT count(*) INTO v_existing_job_count
      FROM job_queue jq
      WHERE jq.package_id = rec.package_id AND jq.job_type = v_job_type
        AND jq.status IN ('pending','queued','processing','running','batch_pending');

      IF v_existing_job_count > 0 THEN
        UPDATE package_steps SET status = 'queued'::step_status, last_error = NULL
        WHERE package_id = rec.package_id AND step_key = rec.step_key;
        out_package_id := rec.package_id; out_step_key := rec.step_key;
        out_action := 'restored_queued_job_exists'; out_detail := v_job_type;
        RETURN NEXT;
        CONTINUE;
      END IF;

      SELECT * INTO v_enqueue_result FROM enqueue_job_if_absent(
        v_job_type, rec.package_id, 0, 3, now(),
        jsonb_build_object('package_id', rec.package_id, 'curriculum_id', rec.curriculum_id, 'step_key', rec.step_key)
      );

      IF v_enqueue_result.created THEN
        UPDATE package_steps SET status = 'queued'::step_status, last_error = NULL
        WHERE package_id = rec.package_id AND step_key = rec.step_key;
        out_package_id := rec.package_id; out_step_key := rec.step_key;
        out_action := 'enqueued'; out_detail := v_job_type;
        RETURN NEXT;
      ELSE
        UPDATE package_steps SET attempts = COALESCE(attempts,0) + 1,
          last_error = COALESCE(v_enqueue_result.status,'rejected_again'),
          updated_at = now()
        WHERE package_id = rec.package_id AND step_key = rec.step_key;
        out_package_id := rec.package_id; out_step_key := rec.step_key;
        out_action := 'still_rejected'; out_detail := v_enqueue_result.status;
        RETURN NEXT;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES ('resolve_pending_enqueue_per_row_error','package',rec.package_id::text,'error',
        jsonb_build_object('step_key',rec.step_key,'error',SQLERRM,'sqlstate',SQLSTATE));
      out_package_id := rec.package_id; out_step_key := rec.step_key;
      out_action := 'error_per_row'; out_detail := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$;
