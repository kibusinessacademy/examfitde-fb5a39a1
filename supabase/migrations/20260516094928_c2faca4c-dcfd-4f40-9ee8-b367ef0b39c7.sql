-- Bridge 11 — Autonomous Recovery & Optimization Layer

CREATE TABLE IF NOT EXISTS public.optimization_guardrails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardrail_key text NOT NULL UNIQUE,
  scope text NOT NULL CHECK (scope IN ('intervention','tutor_mode','curriculum','question_pool','rescue_sequence','cohort','activation')),
  rule_type text NOT NULL CHECK (rule_type IN ('hard_block','requires_approval','soft_warning')),
  description text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.optimization_guardrails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_optimization_guardrails" ON public.optimization_guardrails
  FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
CREATE POLICY "admin_read_optimization_guardrails" ON public.optimization_guardrails
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));

INSERT INTO public.optimization_guardrails (guardrail_key, scope, rule_type, description, config) VALUES
  ('no_curriculum_rewrite','curriculum','hard_block','Autonomous layer must NEVER rewrite curriculum content.','{}'),
  ('no_free_content_generation','question_pool','hard_block','Autonomous layer must NEVER generate free exam content.','{}'),
  ('no_unverified_exam_logic','question_pool','hard_block','Autonomous layer must NEVER change exam scoring logic.','{}'),
  ('intervention_downrank_min_runs','intervention','requires_approval','Downrank only if sample_size >= threshold.','{"min_runs":30}'),
  ('tutor_mode_block_requires_neg_lift','tutor_mode','requires_approval','Block tutor mode only on measured negative lift.','{"min_neg_lift":-0.05,"min_runs":20}'),
  ('rescue_reweight_min_delta','rescue_sequence','soft_warning','Reweight rescue sequences only if delta > threshold.','{"min_delta":0.03}'),
  ('cohort_alert_threshold','cohort','soft_warning','Cohort intervention requires sustained drop signal.','{"min_drop_pct":15,"min_window_days":7}')
ON CONFLICT (guardrail_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.system_optimization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN (
    'ineffective_intervention','negative_tutor_path','curriculum_drift',
    'weak_simulation','lf_drift','low_activation','cohort_anomaly','question_misclassification'
  )),
  scope text NOT NULL CHECK (scope IN ('intervention','tutor_mode','curriculum','question_pool','rescue_sequence','cohort','activation','package','organization')),
  target_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')) DEFAULT 'MEDIUM',
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric,
  status text NOT NULL CHECK (status IN ('detected','queued','acted_on','dismissed','blocked_by_guardrail')) DEFAULT 'detected',
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_sys_opt_events_status ON public.system_optimization_events(status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_sys_opt_events_type ON public.system_optimization_events(event_type, severity);
ALTER TABLE public.system_optimization_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_sys_opt_events" ON public.system_optimization_events
  FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
CREATE POLICY "admin_read_sys_opt_events" ON public.system_optimization_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.auto_tuning_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_id uuid REFERENCES public.system_optimization_events(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type IN (
    'downrank_intervention','block_tutor_mode','reweight_rescue_sequence',
    'flag_question_repair','flag_curriculum_drift','trigger_trainer_alert','adjust_nba_weight'
  )),
  scope text NOT NULL,
  target_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_change jsonb NOT NULL DEFAULT '{}'::jsonb,
  guardrail_key text REFERENCES public.optimization_guardrails(guardrail_key),
  requires_approval boolean NOT NULL DEFAULT true,
  status text NOT NULL CHECK (status IN ('proposed','approved','applied','reverted','blocked','rejected')) DEFAULT 'proposed',
  applied_at timestamptz,
  reverted_at timestamptz,
  applied_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auto_tuning_status ON public.auto_tuning_actions(status, created_at DESC);
ALTER TABLE public.auto_tuning_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_auto_tuning" ON public.auto_tuning_actions
  FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
CREATE POLICY "admin_read_auto_tuning" ON public.auto_tuning_actions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));

CREATE OR REPLACE VIEW public.v_failed_intervention_clusters AS
SELECT
  ies.intervention_type,
  ies.risk_bucket,
  ies.lf_code,
  ies.sample_size,
  ies.pass_rate_lift_pp AS avg_lift,
  ies.confidence_label,
  CASE
    WHEN ies.pass_rate_lift_pp < -5 AND ies.sample_size >= 30 THEN 'CRITICAL'
    WHEN ies.pass_rate_lift_pp < 0 AND ies.sample_size >= 20 THEN 'HIGH'
    WHEN ies.pass_rate_lift_pp < 2 AND ies.sample_size >= 15 THEN 'MEDIUM'
    ELSE 'LOW'
  END AS severity,
  ies.computed_at
FROM public.intervention_effectiveness_scores ies
WHERE ies.pass_rate_lift_pp IS NOT NULL
  AND ies.pass_rate_lift_pp < 5
  AND ies.sample_size >= 10;

REVOKE ALL ON public.v_failed_intervention_clusters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_failed_intervention_clusters TO service_role;

CREATE OR REPLACE VIEW public.v_curriculum_drift_patterns AS
SELECT
  cs.cohort_type,
  cs.cohort_key,
  cs.curriculum_id,
  cs.snapshot_date,
  cs.avg_readiness,
  cs.pct_at_risk,
  LAG(cs.avg_readiness) OVER (PARTITION BY cs.curriculum_id ORDER BY cs.snapshot_date) AS prev_readiness,
  (cs.avg_readiness - LAG(cs.avg_readiness) OVER (PARTITION BY cs.curriculum_id ORDER BY cs.snapshot_date)) AS readiness_delta
FROM public.cohort_snapshots cs
WHERE cs.cohort_type='curriculum'
  AND cs.snapshot_date >= (CURRENT_DATE - INTERVAL '30 days');

REVOKE ALL ON public.v_curriculum_drift_patterns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_curriculum_drift_patterns TO service_role;

CREATE OR REPLACE VIEW public.v_system_optimization_candidates AS
SELECT
  'ineffective_intervention'::text AS event_type,
  'intervention'::text AS scope,
  jsonb_build_object('intervention_type', intervention_type, 'risk_bucket', risk_bucket, 'lf_code', lf_code) AS target_ref,
  severity,
  jsonb_build_object('avg_lift', avg_lift, 'sample_size', sample_size, 'confidence_label', confidence_label) AS signals,
  NULL::numeric AS confidence
FROM public.v_failed_intervention_clusters
WHERE severity IN ('HIGH','CRITICAL')
UNION ALL
SELECT
  'curriculum_drift'::text,
  'curriculum'::text,
  jsonb_build_object('curriculum_id', curriculum_id),
  CASE WHEN readiness_delta < -10 THEN 'CRITICAL'
       WHEN readiness_delta < -5 THEN 'HIGH'
       ELSE 'MEDIUM' END,
  jsonb_build_object('readiness_delta', readiness_delta, 'snapshot_date', snapshot_date),
  NULL::numeric
FROM public.v_curriculum_drift_patterns
WHERE readiness_delta IS NOT NULL AND readiness_delta < -3;

REVOKE ALL ON public.v_system_optimization_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_system_optimization_candidates TO service_role;

CREATE OR REPLACE FUNCTION public.fn_detect_optimization_candidates()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_inserted int := 0; r record; v_existing uuid;
BEGIN
  FOR r IN SELECT * FROM public.v_system_optimization_candidates LOOP
    SELECT id INTO v_existing FROM public.system_optimization_events
      WHERE event_type=r.event_type AND target_ref=r.target_ref
        AND status IN ('detected','queued')
        AND detected_at > now() - INTERVAL '7 days'
      LIMIT 1;
    IF v_existing IS NULL THEN
      INSERT INTO public.system_optimization_events(event_type,scope,target_ref,severity,signals,confidence)
      VALUES (r.event_type,r.scope,r.target_ref,r.severity,r.signals,r.confidence);
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;
  INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES ('optimization_candidate_detected','system',NULL,'completed',
          jsonb_build_object('inserted',v_inserted,'detected_at',now()));
  RETURN jsonb_build_object('inserted',v_inserted);
END;$$;
REVOKE ALL ON FUNCTION public.fn_detect_optimization_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_detect_optimization_candidates() TO service_role;

CREATE OR REPLACE FUNCTION public.fn_apply_auto_tuning_action(p_action_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_action public.auto_tuning_actions%ROWTYPE; v_guardrail public.optimization_guardrails%ROWTYPE;
BEGIN
  SELECT * INTO v_action FROM public.auto_tuning_actions WHERE id=p_action_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'action_not_found'; END IF;
  IF v_action.status NOT IN ('proposed','approved') THEN
    RAISE EXCEPTION 'action_not_applicable_status=%', v_action.status;
  END IF;
  IF v_action.guardrail_key IS NOT NULL THEN
    SELECT * INTO v_guardrail FROM public.optimization_guardrails WHERE guardrail_key=v_action.guardrail_key;
    IF FOUND AND v_guardrail.rule_type='hard_block' THEN
      UPDATE public.auto_tuning_actions SET status='blocked',
        notes=COALESCE(notes,'')||' guardrail_hard_block' WHERE id=p_action_id;
      RETURN jsonb_build_object('ok',false,'reason','hard_block');
    END IF;
    IF FOUND AND v_guardrail.rule_type='requires_approval' AND v_action.status<>'approved' THEN
      RETURN jsonb_build_object('ok',false,'reason','requires_approval');
    END IF;
  END IF;
  UPDATE public.auto_tuning_actions SET status='applied', applied_at=now() WHERE id=p_action_id;
  UPDATE public.system_optimization_events SET status='acted_on', resolved_at=now()
    WHERE id=v_action.source_event_id;
  INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES ('auto_tuning_action_applied','auto_tuning_action',p_action_id,'completed',
          jsonb_build_object('action_type',v_action.action_type,'scope',v_action.scope,'target_ref',v_action.target_ref));
  RETURN jsonb_build_object('ok',true);
END;$$;
REVOKE ALL ON FUNCTION public.fn_apply_auto_tuning_action(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_auto_tuning_action(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_autonomous_optimization_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN jsonb_build_object(
    'events',(
      SELECT jsonb_build_object(
        'total',COUNT(*),
        'detected',COUNT(*) FILTER (WHERE status='detected'),
        'acted_on',COUNT(*) FILTER (WHERE status='acted_on'),
        'blocked',COUNT(*) FILTER (WHERE status='blocked_by_guardrail'),
        'critical',COUNT(*) FILTER (WHERE severity='CRITICAL'),
        'by_type',(SELECT jsonb_object_agg(event_type,c) FROM (
          SELECT event_type,COUNT(*) c FROM public.system_optimization_events
          WHERE detected_at > now()-INTERVAL '30 days' GROUP BY event_type) t)
      ) FROM public.system_optimization_events WHERE detected_at > now()-INTERVAL '30 days'),
    'actions',(
      SELECT jsonb_build_object(
        'proposed',COUNT(*) FILTER (WHERE status='proposed'),
        'approved',COUNT(*) FILTER (WHERE status='approved'),
        'applied',COUNT(*) FILTER (WHERE status='applied'),
        'reverted',COUNT(*) FILTER (WHERE status='reverted'),
        'blocked',COUNT(*) FILTER (WHERE status='blocked')
      ) FROM public.auto_tuning_actions WHERE created_at > now()-INTERVAL '30 days'),
    'guardrails',(
      SELECT jsonb_agg(jsonb_build_object('key',guardrail_key,'scope',scope,'rule_type',rule_type,'enabled',enabled) ORDER BY guardrail_key)
      FROM public.optimization_guardrails),
    'generated_at',now()
  );
END;$$;
REVOKE ALL ON FUNCTION public.admin_get_autonomous_optimization_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_autonomous_optimization_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_auto_tuning_actions(p_limit int DEFAULT 50, p_status text DEFAULT NULL)
RETURNS SETOF public.auto_tuning_actions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.auto_tuning_actions
    WHERE (p_status IS NULL OR status=p_status)
    ORDER BY created_at DESC LIMIT p_limit;
END;$$;
REVOKE ALL ON FUNCTION public.admin_get_auto_tuning_actions(int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_auto_tuning_actions(int,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_approve_auto_tuning_action(p_action_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.auto_tuning_actions SET status='approved', applied_by=auth.uid(),
    notes=COALESCE(p_notes,notes) WHERE id=p_action_id AND status='proposed';
  INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES ('auto_tuning_action_approved','auto_tuning_action',p_action_id,'approved',
          jsonb_build_object('approved_by',auth.uid(),'notes',p_notes));
  PERFORM public.fn_apply_auto_tuning_action(p_action_id);
  RETURN jsonb_build_object('ok',true);
END;$$;
REVOKE ALL ON FUNCTION public.admin_approve_auto_tuning_action(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_auto_tuning_action(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revert_auto_tuning_action(p_action_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_reason IS NULL OR length(p_reason)<3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE public.auto_tuning_actions SET status='reverted', reverted_at=now(),
    notes=COALESCE(notes,'')||' revert: '||p_reason
    WHERE id=p_action_id AND status IN ('applied','approved');
  INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES ('auto_tuning_action_reverted','auto_tuning_action',p_action_id,'reverted',
          jsonb_build_object('reverted_by',auth.uid(),'reason',p_reason));
  RETURN jsonb_build_object('ok',true);
END;$$;
REVOKE ALL ON FUNCTION public.admin_revert_auto_tuning_action(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revert_auto_tuning_action(uuid,text) TO authenticated;