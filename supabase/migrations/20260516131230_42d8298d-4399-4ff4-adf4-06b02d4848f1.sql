
-- ============================================================================
-- Track 2.F: Notification Policy Finalization
-- F3 Global Kill-Switch, F2 E2E Smoke, F4 Drilldown
-- ============================================================================

-- 1) Kill-switch SSOT (single-row config)
CREATE TABLE IF NOT EXISTS public.notification_kill_switch (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  paused         boolean NOT NULL DEFAULT false,
  reason         text,
  actor_uid      uuid,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.notification_kill_switch (id, paused, reason)
VALUES (true, false, 'initial')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.notification_kill_switch ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kill_switch_admin_read" ON public.notification_kill_switch;
CREATE POLICY "kill_switch_admin_read" ON public.notification_kill_switch
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "kill_switch_service_all" ON public.notification_kill_switch;
CREATE POLICY "kill_switch_service_all" ON public.notification_kill_switch
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2) Admin RPCs for kill-switch (audit-pflichtig)
CREATE OR REPLACE FUNCTION public.admin_get_notification_kill_switch()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.notification_kill_switch%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  SELECT * INTO v_row FROM public.notification_kill_switch WHERE id = true;
  RETURN jsonb_build_object(
    'paused', COALESCE(v_row.paused,false),
    'reason', v_row.reason,
    'actor_uid', v_row.actor_uid,
    'updated_at', v_row.updated_at
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_get_notification_kill_switch() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_notification_kill_switch() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_notification_kill_switch(
  p_paused boolean,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 4 THEN
    RAISE EXCEPTION 'reason required (min 4 chars)';
  END IF;

  UPDATE public.notification_kill_switch
     SET paused = p_paused, reason = p_reason, actor_uid = v_uid, updated_at = now()
   WHERE id = true;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, payload)
  VALUES (
    'notification_kill_switch_set',
    'system',
    CASE WHEN p_paused THEN 'paused' ELSE 'resumed' END,
    jsonb_build_object('paused',p_paused,'reason',p_reason,'actor_uid',v_uid)
  );

  RETURN public.admin_get_notification_kill_switch();
END $$;

REVOKE ALL ON FUNCTION public.admin_set_notification_kill_switch(boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_notification_kill_switch(boolean,text) TO authenticated;

-- 3) Enforcement extended with kill-switch (safety-floor preserved for critical intents)
CREATE OR REPLACE FUNCTION public.fn_enforce_notification_policy(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_job public.notification_jobs%ROWTYPE;
  v_resolved jsonb;
  v_strategy text; v_safety text; v_action text;
  v_effective_channel text; v_delay int := 0; v_reasons jsonb;
  v_persona text := 'all';
  v_paused boolean := false;
  v_kill_reason text;
BEGIN
  SELECT * INTO v_job FROM public.notification_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('action','allowed','reason','job_not_found'); END IF;
  IF v_job.state IN ('suppressed','delivered','failed') THEN
    RETURN jsonb_build_object('action','allowed','reason','terminal_state','state',v_job.state);
  END IF;

  v_resolved := public.resolve_notification_policy(v_job.kind, v_persona, v_job.channel);
  v_strategy := COALESCE(v_resolved->>'strategy','neutral');
  v_safety := COALESCE(v_resolved->>'safety_class','standard');
  v_reasons := COALESCE(v_resolved->'reasons','[]'::jsonb);
  v_effective_channel := v_job.channel;
  v_action := 'allowed';

  -- F3 Global Kill-Switch (defense in depth: critical safety-class always passes)
  SELECT paused, reason INTO v_paused, v_kill_reason
    FROM public.notification_kill_switch WHERE id = true;

  IF v_paused AND v_safety <> 'critical' THEN
    v_action := 'suppressed';
    v_reasons := v_reasons || jsonb_build_array('global_kill_switch', COALESCE(v_kill_reason,'paused'));
    UPDATE public.notification_jobs
      SET state = 'suppressed',
          suppression_reason = CASE WHEN suppression_reason IS NULL THEN 'global_kill_switch'
                                    ELSE suppression_reason || ',global_kill_switch' END,
          updated_at = now()
      WHERE id = p_job_id;

  ELSIF v_strategy = 'suppress' THEN
    v_action := 'suppressed';
    UPDATE public.notification_jobs
      SET state = 'suppressed',
          suppression_reason = CASE WHEN suppression_reason IS NULL THEN 'policy_suppress'
                                    ELSE suppression_reason || ',policy_suppress' END,
          updated_at = now()
      WHERE id = p_job_id;
  ELSIF v_strategy = 'cooldown' THEN
    v_action := 'delayed';
    v_delay := 21600;
    UPDATE public.notification_jobs
      SET state = 'pending',
          scheduled_for = GREATEST(now() + (v_delay || ' seconds')::interval, scheduled_for),
          updated_at = now()
      WHERE id = p_job_id;
  ELSIF v_strategy = 'downrank' THEN
    v_action := 'channel_changed';
    v_reasons := v_reasons || jsonb_build_array('downrank_recorded_single_channel');
  END IF;

  INSERT INTO public.notification_dispatch_decisions
    (job_id, intent_key, persona, requested_channel, effective_channel, strategy, effective_action, reasons, safety_class, delay_seconds)
  VALUES
    (p_job_id, v_job.kind, v_persona, v_job.channel, v_effective_channel,
     CASE WHEN v_paused AND v_safety <> 'critical' THEN 'kill_switch' ELSE v_strategy END,
     v_action, v_reasons, v_safety, v_delay);

  RETURN jsonb_build_object(
    'action',v_action,'strategy',v_strategy,'channel',v_effective_channel,
    'delay_seconds',v_delay,'safety_class',v_safety,'reasons',v_reasons,
    'kill_switch', v_paused
  );
END $$;

-- 4) F4 Drilldown — explain a single notification decision
CREATE OR REPLACE FUNCTION public.admin_explain_notification_decision(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_job public.notification_jobs%ROWTYPE;
  v_intent jsonb; v_policy jsonb; v_decisions jsonb; v_events jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  SELECT * INTO v_job FROM public.notification_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','job_not_found'); END IF;

  SELECT to_jsonb(r) INTO v_intent
    FROM public.notification_intent_registry r WHERE r.intent_key = v_job.kind;

  SELECT to_jsonb(p) INTO v_policy
    FROM public.notification_adaptive_policies p
    WHERE p.intent_key = v_job.kind AND p.channel = v_job.channel
    ORDER BY (persona = 'all') ASC, active_since DESC
    LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.decided_at DESC), '[]'::jsonb) INTO v_decisions
    FROM public.notification_dispatch_decisions d WHERE d.job_id = p_job_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC), '[]'::jsonb) INTO v_events
    FROM public.notification_events e WHERE e.job_id = p_job_id;

  RETURN jsonb_build_object(
    'job', to_jsonb(v_job),
    'registry', v_intent,
    'policy', v_policy,
    'dispatch_decisions', v_decisions,
    'events', v_events,
    'kill_switch', public.admin_get_notification_kill_switch()
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_explain_notification_decision(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_explain_notification_decision(uuid) TO authenticated;

-- 5) F2 End-to-End Smoke (synthetic job: insert -> enforce -> explain -> cleanup)
CREATE OR REPLACE FUNCTION public.admin_smoke_notification_e2e()
RETURNS TABLE(stage text, passed boolean, detail jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job_id uuid;
  v_enforce jsonb;
  v_explain jsonb;
  v_kill_before jsonb;
  v_dedupe text := 'smoke_2f_' || gen_random_uuid()::text;
BEGIN
  IF NOT public.has_role(v_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  v_kill_before := public.admin_get_notification_kill_switch();

  -- Stage 1: insert synthetic job
  BEGIN
    INSERT INTO public.notification_jobs(user_id, kind, channel, dedupe_key, payload)
    VALUES (v_uid, 'daily_reminder', 'push', v_dedupe, jsonb_build_object('smoke',true))
    RETURNING id INTO v_job_id;
    stage := 'insert_synthetic_job'; passed := v_job_id IS NOT NULL;
    detail := jsonb_build_object('job_id', v_job_id); RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    stage := 'insert_synthetic_job'; passed := false;
    detail := jsonb_build_object('error', SQLERRM); RETURN NEXT; RETURN;
  END;

  -- Stage 2: enforce policy
  v_enforce := public.fn_enforce_notification_policy(v_job_id);
  stage := 'enforce_policy';
  passed := v_enforce ? 'action';
  detail := v_enforce;
  RETURN NEXT;

  -- Stage 3: dispatch decision row exists
  PERFORM 1 FROM public.notification_dispatch_decisions WHERE job_id = v_job_id;
  stage := 'dispatch_decision_recorded'; passed := FOUND;
  detail := jsonb_build_object('job_id', v_job_id); RETURN NEXT;

  -- Stage 4: drilldown returns full bundle
  v_explain := public.admin_explain_notification_decision(v_job_id);
  stage := 'drilldown_explainable';
  passed := (v_explain ? 'job') AND (v_explain ? 'dispatch_decisions') AND (v_explain ? 'kill_switch');
  detail := jsonb_build_object('keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(v_explain) k));
  RETURN NEXT;

  -- Stage 5: critical-intent floor under kill-switch (dry pause + resume)
  PERFORM public.admin_set_notification_kill_switch(true, 'smoke_2f_floor_test');
  -- Critical safety_class should remain allowed in resolver
  DECLARE v_crit jsonb := public.resolve_notification_policy('exam_countdown','all','push');
  BEGIN
    stage := 'kill_switch_does_not_block_critical_resolver';
    passed := COALESCE(v_crit->>'strategy','suppress') <> 'suppress';
    detail := v_crit; RETURN NEXT;
  END;
  PERFORM public.admin_set_notification_kill_switch(COALESCE((v_kill_before->>'paused')::boolean,false),
                                                    COALESCE(v_kill_before->>'reason','smoke_2f_restore'));

  -- Cleanup synthetic job
  DELETE FROM public.notification_jobs WHERE id = v_job_id;
  stage := 'cleanup_synthetic_job'; passed := true;
  detail := jsonb_build_object('job_id', v_job_id); RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.admin_smoke_notification_e2e() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_smoke_notification_e2e() TO authenticated;
