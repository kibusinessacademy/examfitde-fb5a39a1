
-- L3 — Adaptive Sequencing Engine

CREATE TABLE IF NOT EXISTS public.adaptive_sequencing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  condition_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority int NOT NULL DEFAULT 50,
  weight numeric NOT NULL DEFAULT 1.0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.learner_sequencing_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  rule_key text NOT NULL,
  recommended_action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied boolean NOT NULL DEFAULT false,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lsd_user_curr_time
  ON public.learner_sequencing_decisions (user_id, curriculum_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_lsd_rule_time
  ON public.learner_sequencing_decisions (rule_key, decided_at DESC);

ALTER TABLE public.adaptive_sequencing_policies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learner_sequencing_decisions   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asp_admin_read" ON public.adaptive_sequencing_policies FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "asp_svc_write"  ON public.adaptive_sequencing_policies TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "lsd_self_read"  ON public.learner_sequencing_decisions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "lsd_admin_read" ON public.learner_sequencing_decisions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "lsd_svc_write"  ON public.learner_sequencing_decisions TO service_role USING (true) WITH CHECK (true);

-- Service-role internal state update: evaluate rules → write 1 decision row, return chosen action.
CREATE OR REPLACE FUNCTION public.fn_compute_adaptive_sequence(
  p_user_id uuid,
  p_curriculum_id uuid
)
RETURNS TABLE(decision_id uuid, rule_key text, recommended_action text, payload jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_readiness numeric;
  v_risk text;
  v_difficulty numeric;
  v_weight_pct numeric;
  v_rule record;
  v_chosen_key text := 'continue_default';
  v_chosen_action text := 'continue_learning';
  v_chosen_payload jsonb := '{}'::jsonb;
  v_decision_id uuid;
BEGIN
  -- Pull latest readiness + risk if available (best-effort, NULL-safe)
  BEGIN
    SELECT readiness_score, COALESCE(retention_risk,'unknown')
      INTO v_readiness, v_risk
      FROM public.learner_readiness_history
     WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
     ORDER BY computed_at DESC NULLS LAST LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_readiness := NULL; v_risk := 'unknown'; END;

  SELECT ROUND(AVG(difficulty)::numeric,2), ROUND(AVG(exam_weight_pct)::numeric,2)
    INTO v_difficulty, v_weight_pct
    FROM public.competency_weights
    WHERE curriculum_id = p_curriculum_id;

  -- Evaluate enabled rules in priority order; first match wins
  FOR v_rule IN
    SELECT rule_key, action_jsonb, condition_jsonb
      FROM public.adaptive_sequencing_policies
     WHERE enabled = true
     ORDER BY priority DESC, weight DESC
  LOOP
    IF v_rule.rule_key = 'rescue_high_risk' AND v_risk IN ('high','critical') THEN
      v_chosen_key := v_rule.rule_key; v_chosen_action := 'rescue_session';
      v_chosen_payload := jsonb_build_object('risk', v_risk); EXIT;
    ELSIF v_rule.rule_key = 'recovery_high_difficulty_low_readiness'
         AND COALESCE(v_difficulty,0) >= 4 AND COALESCE(v_readiness,1) < 0.5 THEN
      v_chosen_key := v_rule.rule_key; v_chosen_action := 'lf_gap_drill';
      v_chosen_payload := jsonb_build_object('difficulty', v_difficulty, 'readiness', v_readiness); EXIT;
    ELSIF v_rule.rule_key = 'exam_simulation_high_readiness'
         AND COALESCE(v_readiness,0) >= 0.75 THEN
      v_chosen_key := v_rule.rule_key; v_chosen_action := 'exam_simulation';
      v_chosen_payload := jsonb_build_object('readiness', v_readiness); EXIT;
    ELSIF v_rule.rule_key = 'deprioritize_low_weight_high_mastery'
         AND COALESCE(v_weight_pct,100) < 5 AND COALESCE(v_readiness,0) >= 0.7 THEN
      v_chosen_key := v_rule.rule_key; v_chosen_action := 'maintain_streak';
      v_chosen_payload := jsonb_build_object('exam_weight_pct', v_weight_pct); EXIT;
    END IF;
  END LOOP;

  INSERT INTO public.learner_sequencing_decisions
    (user_id, curriculum_id, rule_key, recommended_action, payload)
  VALUES (p_user_id, p_curriculum_id, v_chosen_key, v_chosen_action,
          v_chosen_payload || jsonb_build_object(
            'readiness', v_readiness, 'risk', v_risk,
            'avg_difficulty', v_difficulty, 'avg_exam_weight_pct', v_weight_pct))
  RETURNING id INTO v_decision_id;

  PERFORM public.fn_emit_audit(
    _action_type := 'adaptive_sequence_computed',
    _target_id   := v_decision_id::text,
    _payload     := jsonb_build_object(
      'decision_id', v_decision_id, 'user_id', p_user_id, 'curriculum_id', p_curriculum_id,
      'rule_key', v_chosen_key, 'recommended_action', v_chosen_action));

  decision_id := v_decision_id; rule_key := v_chosen_key;
  recommended_action := v_chosen_action; payload := v_chosen_payload;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_compute_adaptive_sequence(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compute_adaptive_sequence(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_sequencing_decisions_summary(p_window_days int DEFAULT 7)
RETURNS TABLE(rule_key text, decisions_total bigint, applied_total bigint, distinct_users bigint, last_decided_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT rule_key, COUNT(*),
         COUNT(*) FILTER (WHERE applied),
         COUNT(DISTINCT user_id),
         MAX(decided_at)
  FROM public.learner_sequencing_decisions
  WHERE decided_at > now() - make_interval(days => GREATEST(p_window_days,1))
    AND public.has_role(auth.uid(),'admin'::app_role)
  GROUP BY rule_key
  ORDER BY COUNT(*) DESC;
$$;
REVOKE ALL ON FUNCTION public.admin_get_sequencing_decisions_summary(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_sequencing_decisions_summary(int) TO authenticated;

INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module)
VALUES ('adaptive_sequence_computed',
  ARRAY['decision_id','user_id','curriculum_id','rule_key','recommended_action'],
  'adaptive_sequencing')
ON CONFLICT (action_type) DO NOTHING;

-- Seed 5 baseline rules
INSERT INTO public.adaptive_sequencing_policies (rule_key, description, action_jsonb, priority) VALUES
  ('rescue_high_risk','retention_risk>=high → rescue_session', jsonb_build_object('action','rescue_session'), 90),
  ('recovery_high_difficulty_low_readiness','difficulty>=4 AND readiness<0.5 → lf_gap_drill', jsonb_build_object('action','lf_gap_drill'), 80),
  ('exam_simulation_high_readiness','readiness>=0.75 → exam_simulation', jsonb_build_object('action','exam_simulation'), 70),
  ('deprioritize_low_weight_high_mastery','exam_weight<5 AND readiness>=0.7 → maintain_streak', jsonb_build_object('action','maintain_streak'), 40),
  ('continue_default','default → continue_learning', jsonb_build_object('action','continue_learning'), 10)
ON CONFLICT (rule_key) DO NOTHING;
