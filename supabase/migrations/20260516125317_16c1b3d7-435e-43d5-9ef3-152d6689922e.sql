
CREATE TABLE IF NOT EXISTS public.notification_dispatch_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.notification_jobs(id) ON DELETE CASCADE,
  intent_key text NOT NULL,
  persona text NOT NULL DEFAULT 'all',
  requested_channel text NOT NULL,
  effective_channel text NOT NULL,
  strategy text NOT NULL,
  effective_action text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  safety_class text NOT NULL DEFAULT 'standard',
  delay_seconds integer NOT NULL DEFAULT 0,
  decided_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_dispatch_decisions
  DROP CONSTRAINT IF EXISTS ndd_action_check;
ALTER TABLE public.notification_dispatch_decisions
  ADD CONSTRAINT ndd_action_check
  CHECK (effective_action IN ('allowed','suppressed','delayed','channel_changed'));

CREATE INDEX IF NOT EXISTS idx_ndd_job ON public.notification_dispatch_decisions (job_id);
CREATE INDEX IF NOT EXISTS idx_ndd_recent ON public.notification_dispatch_decisions (intent_key, decided_at DESC);

ALTER TABLE public.notification_dispatch_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read dispatch decisions" ON public.notification_dispatch_decisions;
CREATE POLICY "admins read dispatch decisions"
  ON public.notification_dispatch_decisions FOR SELECT
  USING (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "learners read own dispatch decisions" ON public.notification_dispatch_decisions;
CREATE POLICY "learners read own dispatch decisions"
  ON public.notification_dispatch_decisions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.notification_jobs j WHERE j.id = notification_dispatch_decisions.job_id AND j.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.fn_enforce_notification_policy(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job public.notification_jobs%ROWTYPE;
  v_resolved jsonb;
  v_strategy text; v_safety text; v_action text;
  v_effective_channel text; v_delay int := 0; v_reasons jsonb;
  v_persona text := 'all';
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

  IF v_strategy = 'suppress' THEN
    v_action := 'suppressed';
    UPDATE public.notification_jobs
      SET state = 'suppressed',
          suppression_reason = CASE WHEN suppression_reason IS NULL THEN 'policy_suppress' ELSE suppression_reason || ',policy_suppress' END,
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
    (p_job_id, v_job.kind, v_persona, v_job.channel, v_effective_channel, v_strategy, v_action, v_reasons, v_safety, v_delay);

  RETURN jsonb_build_object('action',v_action,'strategy',v_strategy,'channel',v_effective_channel,'delay_seconds',v_delay,'safety_class',v_safety,'reasons',v_reasons);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_enforce_notification_policy(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_enforce_notification_policy(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_policy_impact_funnel(p_window_hours integer DEFAULT 168)
RETURNS TABLE (intent_key text, total bigint, allowed bigint, suppressed bigint, delayed bigint, channel_changed bigint, suppression_rate numeric, last_decided_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT intent_key,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE effective_action='allowed')::bigint,
    COUNT(*) FILTER (WHERE effective_action='suppressed')::bigint,
    COUNT(*) FILTER (WHERE effective_action='delayed')::bigint,
    COUNT(*) FILTER (WHERE effective_action='channel_changed')::bigint,
    ROUND(CASE WHEN COUNT(*)>0 THEN COUNT(*) FILTER (WHERE effective_action='suppressed')::numeric / COUNT(*)::numeric ELSE 0 END, 4),
    MAX(decided_at)
  FROM public.notification_dispatch_decisions
  WHERE decided_at >= now() - make_interval(hours => GREATEST(1, p_window_hours))
    AND public.has_role(auth.uid(),'admin')
  GROUP BY intent_key
  ORDER BY 2 DESC;
$$;
REVOKE ALL ON FUNCTION public.admin_get_policy_impact_funnel(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_policy_impact_funnel(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_smoke_policy_enforcement()
RETURNS TABLE (check_name text, passed boolean, detail jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;

  v_r := public.resolve_notification_policy('exam_countdown','all','push');
  check_name := 'critical_safety_floor_exam_countdown'; passed := (v_r->>'strategy') IN ('neutral','prefer'); detail := v_r; RETURN NEXT;

  v_r := public.resolve_notification_policy('payment_reminder','all','push');
  check_name := 'critical_safety_floor_payment_reminder'; passed := (v_r->>'strategy') IN ('neutral','prefer'); detail := v_r; RETURN NEXT;

  v_r := public.resolve_notification_policy('non_existent_intent_xyz','all','push');
  check_name := 'missing_intent_suppressed'; passed := (v_r->>'strategy') = 'suppress'; detail := v_r; RETURN NEXT;

  v_r := public.resolve_notification_policy('mastery_milestone','azubi','push');
  check_name := 'persona_fallback_resolves'; passed := v_r ? 'strategy'; detail := v_r; RETURN NEXT;

  PERFORM 1 FROM public.admin_recompute_adaptive_policies(168, true);
  PERFORM 1 FROM public.admin_recompute_adaptive_policies(168, true);
  check_name := 'dry_run_never_flips';
  passed := NOT EXISTS (SELECT 1 FROM public.notification_policy_decisions WHERE decided_at > now() - interval '1 minute' AND guard_action='flip');
  detail := jsonb_build_object('dry_run','double'); RETURN NEXT;

  check_name := 'cooldown_column_present';
  passed := EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notification_adaptive_policies' AND column_name='cooldown_until');
  detail := jsonb_build_object('column','cooldown_until'); RETURN NEXT;
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_smoke_policy_enforcement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_smoke_policy_enforcement() TO authenticated;

-- Extend learner transparency RPC (drop+recreate due to signature change)
DROP FUNCTION IF EXISTS public.learner_get_recent_notifications(integer);
CREATE FUNCTION public.learner_get_recent_notifications(p_limit integer DEFAULT 20)
RETURNS TABLE(
  job_id uuid, kind text, channel text, state text, suppression_reason text,
  scheduled_for timestamptz, delivered_at timestamptz, payload jsonb,
  was_opened boolean, opened_at timestamptz,
  policy_strategy text, policy_action text, policy_reasons jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT j.id, j.kind, j.channel, j.state, j.suppression_reason,
    j.scheduled_for, j.delivered_at, j.payload,
    EXISTS (SELECT 1 FROM public.notification_events e WHERE e.job_id = j.id AND e.event_type = 'notification_opened') AS was_opened,
    (SELECT MIN(occurred_at) FROM public.notification_events e WHERE e.job_id = j.id AND e.event_type = 'notification_opened') AS opened_at,
    d.strategy, d.effective_action, d.reasons
  FROM public.notification_jobs j
  LEFT JOIN LATERAL (
    SELECT strategy, effective_action, reasons
    FROM public.notification_dispatch_decisions
    WHERE job_id = j.id
    ORDER BY decided_at DESC LIMIT 1
  ) d ON true
  WHERE j.user_id = auth.uid()
  ORDER BY j.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;
