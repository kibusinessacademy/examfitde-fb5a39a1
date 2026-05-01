
-- ════════════════════════════════════════════════════════════════════
-- HEAL v3 BIG BANG — Stufe 1+1.5+2+3
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- STUFE 1A: dag_guard_block — Log nur 1×/5min pro signature
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_dag_prerequisites()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_step_key text; v_missing text; v_signature text;
  v_recent_blocks int; v_loop_threshold int := 50; v_loop_window interval := '1 hour';
  v_recent_log_for_sig int;
BEGIN
  IF NEW.status NOT IN ('pending','queued') THEN RETURN NEW; END IF;
  IF (NEW.meta->>'dag_bypass')::boolean IS TRUE THEN RETURN NEW; END IF;
  IF NEW.job_type NOT LIKE 'package_%' THEN RETURN NEW; END IF;
  v_step_key := substring(NEW.job_type FROM 9);

  SELECT string_agg(dag.depends_on,', ' ORDER BY dag.depends_on) INTO v_missing
  FROM step_dag_edges dag
  JOIN package_steps dep ON dep.package_id=NEW.package_id AND dep.step_key=dag.depends_on
  WHERE dag.step_key=v_step_key AND dep.status NOT IN ('done','skipped');

  IF v_missing IS NULL THEN RETURN NEW; END IF;

  v_signature := encode(extensions.digest(NEW.package_id::text||':'||v_step_key||':'||v_missing,'sha256'),'hex');

  SELECT COUNT(*) INTO v_recent_blocks FROM auto_heal_log
  WHERE action_type='dag_guard_block' AND target_id=NEW.package_id::text
    AND metadata->>'signature'=v_signature AND created_at > now()-v_loop_window;

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

  -- NOISE-KILLER: log only 1× per signature per 5min
  SELECT COUNT(*) INTO v_recent_log_for_sig FROM auto_heal_log
  WHERE action_type='dag_guard_block' AND target_id=NEW.package_id::text
    AND metadata->>'signature'=v_signature AND created_at > now()-interval '5 minutes';

  IF v_recent_log_for_sig = 0 THEN
    INSERT INTO auto_heal_log(action_type,trigger_source,target_type,target_id,result_status,result_detail,metadata)
    VALUES ('dag_guard_block','trg_guard_dag_prerequisites','job',COALESCE(NEW.package_id::text,'unknown'),
      'blocked','Blocked '||NEW.job_type||': unmet deps = '||v_missing,
      jsonb_build_object('job_type',NEW.job_type,'package_id',NEW.package_id,
        'missing_deps',v_missing,'signature',v_signature,'recent_blocks_in_hour',v_recent_blocks,
        'note','dedup_5min_per_signature'));
  END IF;

  RETURN NULL;
END $function$;

-- ─────────────────────────────────────────────────────────────────────
-- STUFE 1B: SHADOW_STALLED Auto-Heal RPC (für Guardian)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardian_heal_shadow_stalled(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pkg_age_hours numeric;
  v_recent_heal_attempts int;
  v_oldest_step text;
  v_retry_result jsonb;
  v_task_id uuid;
BEGIN
  -- Eligibility: package must exist, be building, age check
  SELECT EXTRACT(EPOCH FROM (now() - created_at))/3600
    INTO v_pkg_age_hours
  FROM course_packages WHERE id = p_package_id AND status = 'building';

  IF v_pkg_age_hours IS NULL THEN
    RETURN jsonb_build_object('action','skip','reason','not_building_or_missing');
  END IF;

  -- Skip if pkg older than 7 days (likely abandoned, needs human)
  IF v_pkg_age_hours > 168 THEN
    RETURN jsonb_build_object('action','skip','reason','pkg_too_old_for_auto_heal','age_hours',v_pkg_age_hours);
  END IF;

  -- Count recent heal attempts in last 6h
  SELECT COUNT(*) INTO v_recent_heal_attempts
  FROM auto_heal_log
  WHERE action_type = 'shadow_stalled_auto_heal'
    AND target_id = p_package_id::text
    AND created_at > now() - interval '6 hours';

  -- After 3 attempts → escalate to backlog
  IF v_recent_heal_attempts >= 3 THEN
    BEGIN
      v_task_id := admin_create_permanent_fix_task(
        p_pattern_key := encode(extensions.digest('shadow_stalled|'||p_package_id::text,'sha1'),'hex'),
        p_cluster := 'shadow_stalled_auto_heal',
        p_package_id := p_package_id,
        p_title := 'SHADOW_STALLED: Auto-Heal erschöpft (3× erfolglos)',
        p_description := 'Paket '||p_package_id||' war wiederholt SHADOW_STALLED, 3 Auto-Heal-Versuche in 6h ohne Erfolg. Manuelle Diagnose erforderlich.',
        p_priority := 'high',
        p_recommendation_id := NULL
      );
    EXCEPTION WHEN OTHERS THEN v_task_id := NULL; END;

    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('shadow_stalled_auto_heal','guardian_heal_shadow_stalled','course_package',p_package_id::text,
      'escalated','Escalated to permanent_fix_backlog after 3 failed attempts',
      jsonb_build_object('attempts_6h',v_recent_heal_attempts,'task_id',v_task_id));

    RETURN jsonb_build_object('action','escalate','task_id',v_task_id,'attempts_6h',v_recent_heal_attempts);
  END IF;

  -- Find oldest queued/processing step
  SELECT step_key INTO v_oldest_step
  FROM package_steps
  WHERE package_id = p_package_id
    AND status::text IN ('queued','processing','failed')
  ORDER BY updated_at ASC
  LIMIT 1;

  IF v_oldest_step IS NULL THEN
    RETURN jsonb_build_object('action','skip','reason','no_actionable_step');
  END IF;

  -- Try retry
  BEGIN
    v_retry_result := admin_retry_failed_step(p_package_id, v_oldest_step, 'guardian_shadow_heal');
  EXCEPTION WHEN OTHERS THEN
    v_retry_result := jsonb_build_object('error',SQLERRM);
  END;

  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('shadow_stalled_auto_heal','guardian_heal_shadow_stalled','course_package',p_package_id::text,
    CASE WHEN v_retry_result ? 'error' THEN 'failed' ELSE 'applied' END,
    'Auto-retry oldest step: '||v_oldest_step,
    jsonb_build_object('step_key',v_oldest_step,'retry_result',v_retry_result,'attempt_no',v_recent_heal_attempts+1));

  RETURN jsonb_build_object('action','retry','step_key',v_oldest_step,'attempt_no',v_recent_heal_attempts+1,'result',v_retry_result);
END $$;

REVOKE ALL ON FUNCTION public.guardian_heal_shadow_stalled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardian_heal_shadow_stalled(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- STUFE 2: generate_exam_pool 3-Stufen-Fallback
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.exam_pool_fallback_state (
  package_id uuid PRIMARY KEY REFERENCES course_packages(id) ON DELETE CASCADE,
  fail_count_6h int NOT NULL DEFAULT 0,
  current_stage text NOT NULL DEFAULT 'normal' CHECK (current_stage IN ('normal','provider_switch','constraint_relax','paused')),
  last_fail_at timestamptz,
  last_stage_change_at timestamptz NOT NULL DEFAULT now(),
  model_override text,
  constraint_overrides jsonb DEFAULT '{}'::jsonb,
  paused_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.exam_pool_fallback_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_fallback_state" ON public.exam_pool_fallback_state
  FOR SELECT USING (has_role(auth.uid(),'admin'));
CREATE POLICY "service_write_fallback_state" ON public.exam_pool_fallback_state
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

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
BEGIN
  SELECT * INTO v_state FROM exam_pool_fallback_state WHERE package_id = p_package_id;

  -- Count failed exam_pool jobs in last 6h
  SELECT COUNT(*) INTO v_recent_fails
  FROM job_queue
  WHERE package_id = p_package_id
    AND job_type IN ('package_generate_exam_pool','package_repair_exam_pool_quality')
    AND status = 'failed'
    AND updated_at > now() - interval '6 hours';

  -- Decide stage
  v_new_stage := CASE
    WHEN v_recent_fails >= 8 THEN 'paused'
    WHEN v_recent_fails >= 5 THEN 'constraint_relax'
    WHEN v_recent_fails >= 3 THEN 'provider_switch'
    ELSE 'normal'
  END;

  v_model := CASE v_new_stage
    WHEN 'provider_switch' THEN 'openai/gpt-5-mini'
    WHEN 'constraint_relax' THEN 'openai/gpt-5-mini'
    WHEN 'paused' THEN NULL
    ELSE NULL
  END;

  v_constraints := CASE v_new_stage
    WHEN 'constraint_relax' THEN jsonb_build_object('lf_coverage_min',80,'bloom_min_relaxed',true,'quality_gates_relaxed',true)
    ELSE '{}'::jsonb
  END;

  INSERT INTO exam_pool_fallback_state(package_id, fail_count_6h, current_stage, last_fail_at, last_stage_change_at, model_override, constraint_overrides)
  VALUES (p_package_id, v_recent_fails, v_new_stage, now(), now(), v_model, v_constraints)
  ON CONFLICT (package_id) DO UPDATE SET
    fail_count_6h = EXCLUDED.fail_count_6h,
    current_stage = EXCLUDED.current_stage,
    last_fail_at = EXCLUDED.last_fail_at,
    last_stage_change_at = CASE WHEN exam_pool_fallback_state.current_stage <> EXCLUDED.current_stage THEN now() ELSE exam_pool_fallback_state.last_stage_change_at END,
    model_override = EXCLUDED.model_override,
    constraint_overrides = EXCLUDED.constraint_overrides,
    updated_at = now();

  -- If paused: create P1 backlog task + admin notification
  IF v_new_stage = 'paused' AND (v_state.current_stage IS DISTINCT FROM 'paused') THEN
    BEGIN
      v_task_id := admin_create_permanent_fix_task(
        p_pattern_key := encode(extensions.digest('exam_pool_fallback_paused|'||p_package_id::text,'sha1'),'hex'),
        p_cluster := 'exam_pool_fallback_paused',
        p_package_id := p_package_id,
        p_title := 'Exam-Pool: PAUSIERT nach 8 Fehlschlägen (6h)',
        p_description := 'generate_exam_pool / repair_exam_pool_quality ist nach 8 Fails in 6h pausiert. Manuelle Analyse + AI-Recommendation erforderlich.',
        p_priority := 'critical',
        p_recommendation_id := NULL
      );
    EXCEPTION WHEN OTHERS THEN v_task_id := NULL; END;

    INSERT INTO admin_notifications(title, body, category, severity, entity_type, entity_id, metadata)
    VALUES ('🛑 Exam-Pool PAUSIERT: '||(SELECT title FROM course_packages WHERE id=p_package_id),
      'Nach 8 Fehlschlägen in 6h wurde der Exam-Pool-Step pausiert. Permanent-Fix-Task wurde erstellt.',
      'pipeline','critical','exam_pool_fallback',p_package_id,
      jsonb_build_object('fail_count_6h',v_recent_fails,'task_id',v_task_id));
  END IF;

  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('exam_pool_fallback_progress','fn_exam_pool_fallback_progress','course_package',p_package_id::text,
    CASE WHEN v_state.current_stage IS DISTINCT FROM v_new_stage THEN 'applied' ELSE 'noop' END,
    'Stage: '||COALESCE(v_state.current_stage,'(new)')||' → '||v_new_stage||' (fails6h='||v_recent_fails||')',
    jsonb_build_object('previous_stage',v_state.current_stage,'new_stage',v_new_stage,'fails_6h',v_recent_fails,'model_override',v_model,'constraints',v_constraints));

  RETURN jsonb_build_object(
    'package_id',p_package_id,
    'previous_stage',v_state.current_stage,
    'new_stage',v_new_stage,
    'fails_6h',v_recent_fails,
    'model_override',v_model,
    'constraints',v_constraints
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_exam_pool_fallback_progress(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_exam_pool_fallback_progress(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- STUFE 3: Per-Course AI Heal Plans
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.course_heal_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES course_packages(id) ON DELETE CASCADE,
  plan jsonb NOT NULL,
  rationale text,
  confidence numeric(3,2),
  model_used text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  hard_fail_count_at_generation int NOT NULL DEFAULT 0,
  trigger_reason text NOT NULL,
  superseded_by uuid REFERENCES course_heal_plans(id),
  is_active boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_course_heal_plans_pkg_active
  ON course_heal_plans(package_id) WHERE is_active = true;

ALTER TABLE public.course_heal_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_heal_plans" ON public.course_heal_plans
  FOR SELECT USING (has_role(auth.uid(),'admin'));
CREATE POLICY "service_write_heal_plans" ON public.course_heal_plans
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.fn_get_active_heal_plan(p_package_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'id', id,
    'plan', plan,
    'rationale', rationale,
    'confidence', confidence,
    'generated_at', generated_at,
    'trigger_reason', trigger_reason
  )
  FROM course_heal_plans
  WHERE package_id = p_package_id AND is_active = true
  ORDER BY generated_at DESC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_active_heal_plan(uuid) TO authenticated, service_role;

-- Trigger: nach hard_fail (attempts >= 3) → Plan veralten und Re-Gen anfordern
CREATE OR REPLACE FUNCTION public.fn_invalidate_heal_plan_on_hard_fail()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.attempts >= 3 AND (OLD.attempts IS NULL OR OLD.attempts < 3) THEN
    UPDATE course_heal_plans SET is_active = false
    WHERE package_id = NEW.package_id AND is_active = true;

    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
    VALUES ('heal_plan_invalidated','fn_invalidate_heal_plan_on_hard_fail','course_package',NEW.package_id::text,
      'invalidated', jsonb_build_object('step_key',NEW.step_key,'attempts',NEW.attempts));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invalidate_heal_plan_on_hard_fail ON public.package_steps;
CREATE TRIGGER trg_invalidate_heal_plan_on_hard_fail
AFTER UPDATE OF attempts ON public.package_steps
FOR EACH ROW EXECUTE FUNCTION public.fn_invalidate_heal_plan_on_hard_fail();

-- ─────────────────────────────────────────────────────────────────────
-- KPI-View: Noise vs Real
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_heal_noise_breakdown AS
SELECT
  action_type,
  COUNT(*) AS events_24h,
  COUNT(DISTINCT target_id) AS distinct_targets,
  COUNT(*) FILTER (WHERE result_status='applied') AS applied,
  COUNT(*) FILTER (WHERE result_status='skipped') AS skipped,
  COUNT(*) FILTER (WHERE result_status='failed') AS failed,
  COUNT(*) FILTER (WHERE result_status='detected') AS detected_only,
  ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT target_id),0), 1) AS avg_events_per_target
FROM auto_heal_log
WHERE created_at > now() - interval '24 hours'
GROUP BY action_type
ORDER BY events_24h DESC;

GRANT SELECT ON public.v_heal_noise_breakdown TO authenticated;
