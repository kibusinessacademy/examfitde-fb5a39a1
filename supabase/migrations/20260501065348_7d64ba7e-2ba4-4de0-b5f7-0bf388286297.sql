-- ─────────────────────────────────────────────────────────────────────
-- HEAL v3 BIG BANG — PATCH MIGRATION (Review-Fixes)
-- ─────────────────────────────────────────────────────────────────────

-- FIX 1+2: DAG-Guard — target_type='course_package' + Loop-Counter aus meta
CREATE OR REPLACE FUNCTION public.fn_guard_dag_prerequisites()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step_key text;
  v_missing text;
  v_signature text;
  v_recent_blocks int; v_loop_threshold int := 50;
  v_recent_log_for_sig int;
  v_current_counter int;
BEGIN
  -- nur für jobs mit step_key relevant
  v_step_key := NEW.payload->>'step_key';
  IF v_step_key IS NULL THEN RETURN NEW; END IF;

  -- prüfe ob alle direkten Prerequisites done sind (vereinfachter Check über payload)
  v_missing := NULLIF(NEW.payload->>'_missing_deps','');
  IF v_missing IS NULL THEN RETURN NEW; END IF;

  v_signature := md5(COALESCE(NEW.package_id::text,'')||'|'||v_step_key||'|'||v_missing);

  -- LOOP-COUNTER aus package_steps.meta (unabhängig vom Log-Dedup)
  SELECT COALESCE((meta->'dag_block_counters'->>v_signature)::int, 0)
  INTO v_current_counter
  FROM package_steps
  WHERE package_id = NEW.package_id AND step_key = v_step_key
  LIMIT 1;

  v_current_counter := COALESCE(v_current_counter, 0) + 1;

  -- Counter persistieren (echter Insert-Loop wird sichtbar, auch bei Log-Dedup)
  UPDATE package_steps
  SET meta = COALESCE(meta,'{}'::jsonb)
           || jsonb_build_object(
                'dag_block_counters',
                COALESCE(meta->'dag_block_counters','{}'::jsonb)
                  || jsonb_build_object(v_signature, v_current_counter)
              )
  WHERE package_id = NEW.package_id AND step_key = v_step_key
    AND status::text NOT IN ('blocked','done','skipped');

  v_recent_blocks := v_current_counter;

  -- Schwelle erreicht → step blocken + 1× loggen
  IF v_recent_blocks >= v_loop_threshold THEN
    UPDATE package_steps
    SET status='blocked'::step_status,
        last_error='DAG_GUARD_LOOP_DETECTED: '||v_recent_blocks||' identical blocks for missing deps ['||v_missing||']',
        meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object(
          'dag_guard_loop_detected',true,'block_signature',v_signature,
          'missing_deps',v_missing,'recent_blocks',v_recent_blocks,'detected_at',now())
    WHERE package_id=NEW.package_id AND step_key=v_step_key
      AND status::text NOT IN ('blocked','done','skipped');

    INSERT INTO auto_heal_log(action_type,trigger_source,target_type,target_id,result_status,metadata)
    VALUES ('dag_guard_loop_detected','trg_guard_dag_prerequisites','course_package',NEW.package_id::text,
      'blocked',jsonb_build_object('step_key',v_step_key,'missing_deps',v_missing,
        'signature',v_signature,'recent_blocks',v_recent_blocks));
    RETURN NULL;
  END IF;

  -- NOISE-KILLER: log nur 1× pro signature pro 5min (Counter läuft trotzdem)
  SELECT COUNT(*) INTO v_recent_log_for_sig FROM auto_heal_log
  WHERE action_type='dag_guard_block' AND target_id=NEW.package_id::text
    AND metadata->>'signature'=v_signature AND created_at > now()-interval '5 minutes';

  IF v_recent_log_for_sig = 0 THEN
    INSERT INTO auto_heal_log(action_type,trigger_source,target_type,target_id,result_status,result_detail,metadata)
    VALUES ('dag_guard_block','trg_guard_dag_prerequisites','course_package',COALESCE(NEW.package_id::text,'unknown'),
      'blocked','Blocked '||NEW.job_type||': unmet deps = '||v_missing,
      jsonb_build_object('job_type',NEW.job_type,'package_id',NEW.package_id,
        'missing_deps',v_missing,'signature',v_signature,'block_counter',v_recent_blocks,
        'note','dedup_5min_per_signature_counter_in_meta'));
  END IF;

  RETURN NULL;
END $function$;

-- ─────────────────────────────────────────────────────────────────────
-- FIX 3: Fallback-State — Cancel aktiver exam_pool Jobs bei paused
-- ─────────────────────────────────────────────────────────────────────
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
BEGIN
  SELECT * INTO v_state FROM exam_pool_fallback_state WHERE package_id = p_package_id;
  v_prev_stage := COALESCE(v_state.current_stage, 'normal');

  SELECT COUNT(*) INTO v_recent_fails
  FROM job_queue
  WHERE package_id = p_package_id
    AND job_type = 'generate_exam_pool'
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

  INSERT INTO exam_pool_fallback_state(package_id, fail_count_6h, current_stage, last_stage_change_at, last_evaluated_at, model_override, constraint_overrides)
  VALUES (p_package_id, v_recent_fails, v_new_stage, now(), now(), v_model, v_constraints)
  ON CONFLICT (package_id) DO UPDATE
    SET fail_count_6h = EXCLUDED.fail_count_6h,
        current_stage = EXCLUDED.current_stage,
        last_stage_change_at = CASE WHEN exam_pool_fallback_state.current_stage IS DISTINCT FROM EXCLUDED.current_stage
                                    THEN now() ELSE exam_pool_fallback_state.last_stage_change_at END,
        last_evaluated_at = now(),
        model_override = EXCLUDED.model_override,
        constraint_overrides = EXCLUDED.constraint_overrides;

  -- FIX 3a: Bei Paused-Übergang aktive Jobs cancellen
  IF v_new_stage = 'paused' AND v_prev_stage IS DISTINCT FROM 'paused' THEN
    UPDATE job_queue
    SET status = 'cancelled',
        last_error = 'EXAM_POOL_FALLBACK_PAUSED: 8+ fails in 6h, auto-cancelled by fn_exam_pool_fallback_progress',
        updated_at = now()
    WHERE package_id = p_package_id
      AND job_type = 'generate_exam_pool'
      AND status IN ('queued','processing','pending');
    GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;

    INSERT INTO permanent_fix_backlog(pattern_signature, severity, status, title, description, suggested_action, metadata)
    VALUES (
      'exam_pool_paused:'||p_package_id::text,
      'critical',
      'open',
      'Exam-Pool Fallback PAUSED — Manueller Eingriff nötig',
      'Paket '||p_package_id::text||' hat 8+ generate_exam_pool-Fails in 6h. Fallback-Stage=paused, '||v_cancelled_jobs||' aktive Jobs cancelled.',
      'force_depublish_rebuild',
      jsonb_build_object('package_id', p_package_id, 'fails_6h', v_recent_fails, 'cancelled_jobs', v_cancelled_jobs)
    )
    ON CONFLICT (pattern_signature) DO UPDATE SET
      severity='critical',
      status='open',
      updated_at=now(),
      metadata = permanent_fix_backlog.metadata || EXCLUDED.metadata
    RETURNING id INTO v_task_id;

    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('exam_pool_paused_cancel','fn_exam_pool_fallback_progress','course_package',p_package_id::text,
      'applied',
      'Paused: '||v_cancelled_jobs||' jobs cancelled, P1 task created',
      jsonb_build_object('fail_count_6h',v_recent_fails,'cancelled_jobs',v_cancelled_jobs,'task_id',v_task_id));
  END IF;

  -- Stage-Transition log (1× pro Wechsel)
  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('exam_pool_fallback_stage','fn_exam_pool_fallback_progress','course_package',p_package_id::text,
    CASE WHEN v_prev_stage IS DISTINCT FROM v_new_stage THEN 'applied' ELSE 'noop' END,
    'Stage: '||v_prev_stage||' → '||v_new_stage||' (fails6h='||v_recent_fails||')',
    jsonb_build_object('previous_stage',v_prev_stage,'new_stage',v_new_stage,'fails_6h',v_recent_fails,'model_override',v_model,'constraints',v_constraints));

  RETURN jsonb_build_object(
    'previous_stage',v_prev_stage,
    'new_stage',v_new_stage,
    'fails_6h',v_recent_fails,
    'cancelled_jobs',v_cancelled_jobs,
    'model_override',v_model,
    'constraints',v_constraints
  );
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- FIX 4: Heal-Plan zusätzlicher Trigger auf job_queue
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_invalidate_heal_plan_on_job_hard_fail()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'failed'
     AND NEW.attempts >= 3
     AND (OLD.attempts IS NULL OR OLD.attempts < 3)
     AND NEW.package_id IS NOT NULL THEN
    UPDATE course_heal_plans SET is_active = false
    WHERE package_id = NEW.package_id AND is_active = true;

    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
    VALUES ('heal_plan_invalidated','fn_invalidate_heal_plan_on_job_hard_fail','course_package',NEW.package_id::text,
      'invalidated', jsonb_build_object('job_type',NEW.job_type,'attempts',NEW.attempts,'job_id',NEW.id));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invalidate_heal_plan_on_job_hard_fail ON public.job_queue;
CREATE TRIGGER trg_invalidate_heal_plan_on_job_hard_fail
AFTER UPDATE OF attempts, status ON public.job_queue
FOR EACH ROW EXECUTE FUNCTION public.fn_invalidate_heal_plan_on_job_hard_fail();

-- ─────────────────────────────────────────────────────────────────────
-- FIX 5: Security — fn_get_active_heal_plan nur für service_role + Admins
-- ─────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_get_active_heal_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_get_active_heal_plan(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_active_heal_plan(uuid) TO service_role;

-- Admin-Wrapper für UI-Zugriff (mit has_role-Check)
CREATE OR REPLACE FUNCTION public.admin_get_active_heal_plan(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
  END IF;
  RETURN public.fn_get_active_heal_plan(p_package_id);
END $$;

REVOKE ALL ON FUNCTION public.admin_get_active_heal_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_active_heal_plan(uuid) TO authenticated, service_role;