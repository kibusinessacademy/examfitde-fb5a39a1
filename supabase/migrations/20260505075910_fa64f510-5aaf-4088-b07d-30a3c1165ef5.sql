-- ============================================================================
-- ExamFit Pipeline Loop Hardening v1
-- 1) Global block awareness  2) Package-level cooldown for drift healers
-- 3) enqueue_source_missing_warn noise throttling  4) safe trigger bypass
-- ============================================================================

-- 1. Globaler Block-State
CREATE OR REPLACE FUNCTION public.fn_is_package_progress_blocked(p_package_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    public.fn_is_bronze_locked(p_package_id)
    OR EXISTS (
      SELECT 1 FROM package_steps ps
      WHERE ps.package_id = p_package_id
        AND ps.status::text = 'blocked'
    )
    OR EXISTS (
      SELECT 1 FROM course_packages cp
      WHERE cp.id = p_package_id
        AND COALESCE(cp.blocked_reason, '') <> ''
    );
$$;

-- 2. Package-Level Cooldown
CREATE OR REPLACE FUNCTION public.fn_auto_heal_package_cooldown_active(
  p_package_id uuid, p_action_type text, p_window interval DEFAULT interval '30 minutes'
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM auto_heal_log al
    WHERE al.target_id = p_package_id::text
      AND al.action_type = p_action_type
      AND al.created_at > now() - p_window
  );
$$;

-- 3. Block-Audit für Healer-Skip
CREATE OR REPLACE FUNCTION public.fn_log_auto_heal_blocked_skip(
  p_package_id uuid, p_action_type text, p_step_key text DEFAULT NULL,
  p_reason text DEFAULT 'package_progress_blocked'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    p_action_type || '_skipped', 'package', p_package_id::text, 'skipped',
    jsonb_build_object(
      'reason', p_reason, 'step_key', p_step_key,
      'bronze_locked', public.fn_is_bronze_locked(p_package_id),
      'progress_blocked', public.fn_is_package_progress_blocked(p_package_id),
      'created_by', 'pipeline_loop_hardening_v1'
    )
  );
END;
$$;

-- 4. Noise-Throttle für enqueue_source_missing_warn
CREATE OR REPLACE FUNCTION public.fn_should_log_enqueue_source_missing(
  p_job_type text, p_caller text DEFAULT NULL, p_sample_rate integer DEFAULT 100
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_recent_count integer;
BEGIN
  SELECT COUNT(*) INTO v_recent_count FROM auto_heal_log
  WHERE action_type = 'enqueue_source_missing_warn'
    AND created_at > now() - interval '10 minutes'
    AND COALESCE(metadata->>'job_type','') = COALESCE(p_job_type,'')
    AND COALESCE(metadata->>'caller','') = COALESCE(p_caller,'');
  RETURN v_recent_count < 3 OR (v_recent_count % GREATEST(p_sample_rate, 1) = 0);
END;
$$;

-- 5. Safe Bypass Helper
CREATE OR REPLACE FUNCTION public.fn_app_trigger_bypass_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(current_setting('app.bypass_triggers', true), 'false') = 'true';
$$;

-- 6. Patch: pipeline_step_drift_v3 — Block-Awareness + Package-Cooldown
CREATE OR REPLACE FUNCTION public.fn_detect_and_heal_pipeline_step_drift_v3()
RETURNS TABLE(package_id uuid, step_key text, action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    -- NEW v1: Global block awareness
    IF public.fn_is_package_progress_blocked(r.pid) THEN
      PERFORM public.fn_log_auto_heal_blocked_skip(
        r.pid, 'pipeline_step_drift_v3_heal', r.skey::text, 'package_progress_blocked'
      );
      CONTINUE;
    END IF;

    -- NEW v1: Package-level cooldown (catches alternating-step bypass)
    IF public.fn_auto_heal_package_cooldown_active(
      r.pid, 'pipeline_step_drift_v3_heal', interval '30 minutes'
    ) THEN
      CONTINUE;
    END IF;

    -- Legacy step-level cooldown (kept as second guard)
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

-- 7. Patch: tail_step_enqueue_drift — Block-Awareness + Package-Cooldown
CREATE OR REPLACE FUNCTION public.fn_detect_tail_step_enqueue_drift()
RETURNS TABLE(package_id uuid, step_key text, action text, job_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_rec record; v_job_id uuid;
  v_total int := 0; v_healed int := 0; v_skipped int := 0; v_blocked int := 0;
BEGIN
  FOR v_rec IN
    SELECT ps.package_id, ps.step_key, ps.updated_at, cp.status AS pkg_status,
           EXTRACT(EPOCH FROM (now() - ps.updated_at))/3600 AS hrs_stuck
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'
      AND ps.updated_at < now() - interval '2 hours'
      AND cp.status = 'building'
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.payload->>'package_id' = ps.package_id::text
          AND jq.job_type = 'package_' || ps.step_key
          AND jq.status IN ('pending','processing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM auto_heal_log ahl
        WHERE ahl.action_type = 'tail_step_enqueue_drift_heal'
          AND ahl.target_id = ps.package_id::text
          AND ahl.metadata->>'step_key' = ps.step_key
          AND ahl.created_at > now() - interval '30 minutes'
      )
      AND NOT EXISTS (
        SELECT 1 FROM step_dag_edges dag
        JOIN package_steps ps2 ON ps2.package_id=ps.package_id AND ps2.step_key=dag.depends_on
        WHERE dag.step_key = ps.step_key AND ps2.status NOT IN ('done','skipped')
      )
    ORDER BY ps.updated_at ASC
    LIMIT 50
  LOOP
    -- NEW v1: Block-awareness
    IF public.fn_is_package_progress_blocked(v_rec.package_id) THEN
      v_blocked := v_blocked + 1;
      PERFORM public.fn_log_auto_heal_blocked_skip(
        v_rec.package_id, 'tail_step_enqueue_drift_heal', v_rec.step_key, 'package_progress_blocked'
      );
      CONTINUE;
    END IF;

    -- NEW v1: Package-level cooldown
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
        jsonb_build_object('step_key', v_rec.step_key, 'job_id', v_job_id,
                           'hrs_stuck', round(v_rec.hrs_stuck::numeric, 1),
                           'pkg_status', v_rec.pkg_status));
      v_healed := v_healed + 1;
      package_id := v_rec.package_id; step_key := v_rec.step_key;
      action := 'enqueued'; job_id := v_job_id; RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('tail_step_enqueue_drift_heal','package', v_rec.package_id::text, 'failed',
              jsonb_build_object('step_key', v_rec.step_key, 'error', SQLERRM));
    END;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('tail_step_enqueue_drift_run','system',
          CASE WHEN v_total=0 AND v_blocked=0 THEN 'noop' ELSE 'success' END,
          jsonb_build_object('total', v_total, 'healed', v_healed,
                             'skipped', v_skipped, 'blocked', v_blocked));
END;
$function$;

-- 8. Patch: enqueue_job_if_absent — Noise-Throttle für enqueue_source_missing_warn
CREATE OR REPLACE FUNCTION public.enqueue_job_if_absent(
  p_job_type text, p_package_id uuid DEFAULT NULL::uuid,
  p_priority integer DEFAULT 0, p_max_attempts integer DEFAULT 25,
  p_run_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(id uuid, created boolean, duplicate boolean, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  v_step_key text; v_existing record; v_new_id uuid;
  v_recent_completed_count int; v_step_status text; v_mapped_step text;
  v_active_count int; v_is_incremental_dispatcher boolean;
  v_fanout_cap int; v_zero_progress_threshold int;
  v_pkg_status text;
  v_enqueue_source text;
  v_enforce_source_at timestamptz := '2026-05-09 00:00:00+00'::timestamptz;
  v_qtype record; v_recent_any record; v_lock_key bigint;
begin
  v_step_key := coalesce(p_payload->>'step_key', p_payload->>'step', p_payload->>'target_step', '');
  v_enqueue_source := coalesce(p_payload->>'enqueue_source','');

  IF v_enqueue_source = '' THEN
    -- v1: Throttle warn-log to reduce noise (3 + every Nth)
    IF now() >= v_enforce_source_at OR public.fn_should_log_enqueue_source_missing(p_job_type, NULL, 100) THEN
      INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id,
                                       result_status, result_detail, metadata)
      VALUES (
        CASE WHEN now() >= v_enforce_source_at THEN 'enqueue_source_missing_blocked'
             ELSE 'enqueue_source_missing_warn' END,
        'enqueue_job_if_absent','job',COALESCE(p_package_id::text,'null'),
        CASE WHEN now() >= v_enforce_source_at THEN 'rejected' ELSE 'warn' END,
        'Missing enqueue_source tag in payload for '||p_job_type,
        jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'step_key',v_step_key,
                           'phase', CASE WHEN now() >= v_enforce_source_at THEN 'enforce' ELSE 'warn' END,
                           'throttled', true));
    END IF;
    IF now() >= v_enforce_source_at THEN
      RETURN QUERY SELECT NULL::uuid, false, false, 'enqueue_source_missing'::text; RETURN;
    END IF;
  END IF;

  SELECT * INTO v_qtype FROM public.job_type_quarantine
   WHERE job_type = p_job_type AND cleared_at IS NULL AND blocked_until > now() LIMIT 1;
  IF FOUND THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id,
                                     result_status, result_detail, metadata)
    VALUES ('enqueue_blocked_job_type_quarantined','enqueue_job_if_absent','job',
            COALESCE(p_package_id::text,'null'),'rejected',
            format('Job-Type %s quarantined until %s', p_job_type, v_qtype.blocked_until),
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,
                               'enqueue_source',v_enqueue_source,
                               'blocked_until',v_qtype.blocked_until,'reason',v_qtype.reason));
    RETURN QUERY SELECT NULL::uuid, false, false, 'job_type_quarantined'::text; RETURN;
  END IF;

  IF public.fn_step_already_terminal(p_job_type, p_package_id) THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('enqueue_phantom_blocked','enqueue_job_if_absent','job',COALESCE(p_package_id::text,'null'),'rejected',
            'Step already done/skipped for '||p_job_type,
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'step_key',replace(p_job_type,'package_','')));
    RETURN QUERY SELECT NULL::uuid, false, false, 'phantom_blocked'::text; RETURN;
  END IF;

  IF p_package_id IS NOT NULL AND public.fn_job_type_requires_building(p_job_type) THEN
    SELECT cp.status INTO v_pkg_status FROM public.course_packages cp WHERE cp.id = p_package_id;
    IF v_pkg_status IS NULL OR v_pkg_status <> 'building' THEN
      INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('enqueue_non_building_block','enqueue_job_if_absent','job',p_package_id::text,'rejected',
              'Package not in building status for '||p_job_type,
              jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'pkg_status',v_pkg_status));
      RETURN QUERY SELECT NULL::uuid, false, false, 'non_building_blocked'::text; RETURN;
    END IF;
  END IF;

  -- Delegate to legacy body for the remaining locking/dedup/insert path
  RETURN QUERY SELECT * FROM public.enqueue_job_if_absent(p_job_type, p_package_id, p_payload, p_priority, p_max_attempts, p_run_after);
END;
$function$;

-- 9. Audit-Marker
INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
VALUES (
  'pipeline_loop_hardening_v1_deployed', 'system', 'global', 'success',
  jsonb_build_object(
    'features', jsonb_build_array(
      'fn_is_package_progress_blocked','package_level_auto_heal_cooldown',
      'enqueue_source_missing_warn_throttle','safe_trigger_bypass_setting',
      'drift_v3_block_aware','tail_drift_block_aware'),
    'deployed_at', now()
  )
);