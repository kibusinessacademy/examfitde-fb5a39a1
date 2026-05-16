
-- 1) Extend registry with safety class + minimum delivery floor
ALTER TABLE public.notification_intent_registry
  ADD COLUMN IF NOT EXISTS safety_class text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS min_delivery_floor text NOT NULL DEFAULT 'none';

ALTER TABLE public.notification_intent_registry
  DROP CONSTRAINT IF EXISTS notification_intent_registry_safety_class_check;
ALTER TABLE public.notification_intent_registry
  ADD CONSTRAINT notification_intent_registry_safety_class_check
  CHECK (safety_class IN ('standard','sensitive','critical'));

ALTER TABLE public.notification_intent_registry
  DROP CONSTRAINT IF EXISTS notification_intent_registry_min_delivery_floor_check;
ALTER TABLE public.notification_intent_registry
  ADD CONSTRAINT notification_intent_registry_min_delivery_floor_check
  CHECK (min_delivery_floor IN ('none','neutral','prefer'));

UPDATE public.notification_intent_registry
SET safety_class = 'critical', min_delivery_floor = 'neutral'
WHERE intent_key IN ('exam_countdown','payment_reminder','support_reply');

UPDATE public.notification_intent_registry
SET safety_class = 'sensitive'
WHERE intent_key IN ('weak_competency_drill','course_resumption');

-- 2) Adaptive policies (current state)
CREATE TABLE IF NOT EXISTS public.notification_adaptive_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_key text NOT NULL REFERENCES public.notification_intent_registry(intent_key) ON DELETE CASCADE,
  persona text NOT NULL DEFAULT 'all',
  channel text NOT NULL,
  strategy text NOT NULL DEFAULT 'neutral',
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample_size integer NOT NULL DEFAULT 0,
  consecutive_proposals integer NOT NULL DEFAULT 0,
  pending_strategy text,
  pending_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_since timestamptz NOT NULL DEFAULT now(),
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  cooldown_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intent_key, persona, channel)
);

ALTER TABLE public.notification_adaptive_policies
  DROP CONSTRAINT IF EXISTS notification_adaptive_policies_strategy_check;
ALTER TABLE public.notification_adaptive_policies
  ADD CONSTRAINT notification_adaptive_policies_strategy_check
  CHECK (strategy IN ('prefer','neutral','downrank','cooldown','suppress'));

ALTER TABLE public.notification_adaptive_policies
  DROP CONSTRAINT IF EXISTS notification_adaptive_policies_pending_strategy_check;
ALTER TABLE public.notification_adaptive_policies
  ADD CONSTRAINT notification_adaptive_policies_pending_strategy_check
  CHECK (pending_strategy IS NULL OR pending_strategy IN ('prefer','neutral','downrank','cooldown','suppress'));

CREATE INDEX IF NOT EXISTS idx_nap_lookup
  ON public.notification_adaptive_policies (intent_key, persona, channel);

ALTER TABLE public.notification_adaptive_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read adaptive policies" ON public.notification_adaptive_policies;
CREATE POLICY "admins read adaptive policies"
  ON public.notification_adaptive_policies
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) Decision audit log (append only)
CREATE TABLE IF NOT EXISTS public.notification_policy_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_key text NOT NULL,
  persona text NOT NULL,
  channel text NOT NULL,
  window_hours integer NOT NULL,
  sample_size integer NOT NULL,
  current_strategy text NOT NULL,
  proposed_strategy text NOT NULL,
  applied_strategy text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  guard_action text NOT NULL,
  decided_by text NOT NULL DEFAULT 'engine',
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_npd_recent
  ON public.notification_policy_decisions (intent_key, persona, channel, decided_at DESC);

ALTER TABLE public.notification_policy_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read policy decisions" ON public.notification_policy_decisions;
CREATE POLICY "admins read policy decisions"
  ON public.notification_policy_decisions
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_nap_updated_at ON public.notification_adaptive_policies;
CREATE TRIGGER trg_nap_updated_at
  BEFORE UPDATE ON public.notification_adaptive_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Deterministic recompute engine
CREATE OR REPLACE FUNCTION public.admin_recompute_adaptive_policies(
  p_window_hours integer DEFAULT 168,
  p_dry_run boolean DEFAULT true,
  p_min_sample integer DEFAULT 30,
  p_hysteresis integer DEFAULT 2,
  p_cooldown_hours integer DEFAULT 24
)
RETURNS TABLE (
  intent_key text,
  persona text,
  channel text,
  current_strategy text,
  proposed_strategy text,
  applied_strategy text,
  reasons jsonb,
  guard_action text,
  sample_size integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_row record;
  v_existing public.notification_adaptive_policies%ROWTYPE;
  v_intent record;
  v_proposed text;
  v_applied text;
  v_reasons jsonb;
  v_guard text;
  v_best_channel text;
  v_best_resolved numeric;
BEGIN
  IF NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  -- Compute aggregated metrics from existing effectiveness RPC; fall back to direct queries if shape differs
  FOR v_row IN
    SELECT
      e.intent_key,
      COALESCE(NULLIF(e.persona,''),'all') AS persona,
      e.channel,
      e.sent::int AS sent,
      e.opened::int AS opened,
      e.cta_clicked::int AS cta_clicked,
      e.resolved::int AS resolved,
      COALESCE(e.anomaly_flags,'[]'::jsonb) AS anomaly_flags,
      COALESCE(e.recovery_lift_pct,0)::numeric AS recovery_lift,
      CASE WHEN e.sent::numeric > 0 THEN (e.opened::numeric / e.sent::numeric) ELSE 0 END AS open_rate,
      CASE WHEN e.sent::numeric > 0 THEN (e.resolved::numeric / e.sent::numeric) ELSE 0 END AS resolved_rate
    FROM public.admin_get_notification_effectiveness(p_window_hours) e
  LOOP
    SELECT * INTO v_intent FROM public.notification_intent_registry WHERE intent_key = v_row.intent_key;
    IF NOT FOUND THEN CONTINUE; END IF;

    -- Determine best alternative channel for this intent/persona by resolved_rate
    v_best_channel := NULL;
    v_best_resolved := -1;
    SELECT e2.channel, CASE WHEN e2.sent::numeric>0 THEN e2.resolved::numeric/e2.sent::numeric ELSE 0 END
      INTO v_best_channel, v_best_resolved
    FROM public.admin_get_notification_effectiveness(p_window_hours) e2
    WHERE e2.intent_key = v_row.intent_key
      AND COALESCE(NULLIF(e2.persona,''),'all') = v_row.persona
      AND e2.channel <> v_row.channel
      AND e2.sent::int >= p_min_sample
    ORDER BY 2 DESC
    LIMIT 1;

    v_reasons := '[]'::jsonb;

    IF v_row.sent < p_min_sample THEN
      v_proposed := 'neutral';
      v_reasons := v_reasons || jsonb_build_array('insufficient_sample');
    ELSIF v_row.anomaly_flags ? 'dead_reminder' THEN
      v_proposed := 'downrank';
      v_reasons := v_reasons || jsonb_build_array('dead_reminder');
    ELSIF v_row.anomaly_flags ? 'high_recovery_escalation' THEN
      v_proposed := 'cooldown';
      v_reasons := v_reasons || jsonb_build_array('high_recovery_escalation');
    ELSIF v_row.open_rate < 0.15 AND v_best_channel IS NOT NULL AND v_best_resolved > v_row.resolved_rate THEN
      v_proposed := 'downrank';
      v_reasons := v_reasons || jsonb_build_array('low_open_rate', format('channel_%s_outperforms', v_best_channel));
    ELSIF v_row.resolved_rate >= 0.40 AND v_row.open_rate >= 0.35 THEN
      v_proposed := 'prefer';
      v_reasons := v_reasons || jsonb_build_array('strong_resolved_rate','strong_open_rate');
    ELSIF v_row.anomaly_flags ? 'low_resolved_rate' THEN
      v_proposed := 'downrank';
      v_reasons := v_reasons || jsonb_build_array('low_resolved_rate');
    ELSE
      v_proposed := 'neutral';
      v_reasons := v_reasons || jsonb_build_array('within_normal_range');
    END IF;

    -- Safety guard
    v_guard := 'none';
    IF v_intent.safety_class = 'critical' AND v_proposed IN ('downrank','cooldown','suppress') THEN
      v_proposed := CASE WHEN v_intent.min_delivery_floor = 'prefer' THEN 'prefer' ELSE 'neutral' END;
      v_reasons := v_reasons || jsonb_build_array('safety_critical_clamped');
      v_guard := 'safety_clamp';
    ELSIF v_intent.safety_class = 'sensitive' AND v_proposed = 'suppress' THEN
      v_proposed := 'downrank';
      v_reasons := v_reasons || jsonb_build_array('safety_sensitive_no_suppress');
      v_guard := 'safety_clamp';
    END IF;

    -- Load or seed current policy
    SELECT * INTO v_existing
      FROM public.notification_adaptive_policies
      WHERE intent_key = v_row.intent_key
        AND persona = v_row.persona
        AND channel = v_row.channel;

    IF NOT FOUND THEN
      v_applied := 'neutral';
      IF NOT p_dry_run THEN
        INSERT INTO public.notification_adaptive_policies (intent_key, persona, channel, strategy, reasons, sample_size, pending_strategy, pending_reasons, consecutive_proposals)
        VALUES (v_row.intent_key, v_row.persona, v_row.channel, 'neutral', '[]'::jsonb, v_row.sent,
                CASE WHEN v_proposed <> 'neutral' THEN v_proposed END,
                CASE WHEN v_proposed <> 'neutral' THEN v_reasons ELSE '[]'::jsonb END,
                CASE WHEN v_proposed <> 'neutral' THEN 1 ELSE 0 END);
      END IF;
      IF v_guard = 'none' THEN v_guard := 'seeded'; END IF;
    ELSE
      v_applied := v_existing.strategy;
      IF v_proposed = v_existing.strategy THEN
        -- Reset pending, refresh evaluation
        IF NOT p_dry_run THEN
          UPDATE public.notification_adaptive_policies
            SET pending_strategy = NULL,
                pending_reasons = '[]'::jsonb,
                consecutive_proposals = 0,
                sample_size = v_row.sent,
                last_evaluated_at = now(),
                reasons = v_reasons
            WHERE id = v_existing.id;
        END IF;
        IF v_guard = 'none' THEN v_guard := 'no_change'; END IF;
      ELSE
        -- Different proposal: enforce hysteresis + cooldown
        IF v_existing.cooldown_until IS NOT NULL AND v_existing.cooldown_until > now() THEN
          IF v_guard = 'none' THEN v_guard := 'cooldown_block'; END IF;
          IF NOT p_dry_run THEN
            UPDATE public.notification_adaptive_policies
              SET pending_strategy = v_proposed,
                  pending_reasons = v_reasons,
                  consecutive_proposals = CASE WHEN v_existing.pending_strategy = v_proposed THEN v_existing.consecutive_proposals + 1 ELSE 1 END,
                  sample_size = v_row.sent,
                  last_evaluated_at = now()
              WHERE id = v_existing.id;
          END IF;
        ELSIF v_existing.pending_strategy = v_proposed AND (v_existing.consecutive_proposals + 1) >= p_hysteresis THEN
          v_applied := v_proposed;
          IF v_guard = 'none' THEN v_guard := 'flip'; END IF;
          IF NOT p_dry_run THEN
            UPDATE public.notification_adaptive_policies
              SET strategy = v_proposed,
                  reasons = v_reasons,
                  pending_strategy = NULL,
                  pending_reasons = '[]'::jsonb,
                  consecutive_proposals = 0,
                  sample_size = v_row.sent,
                  active_since = now(),
                  cooldown_until = now() + make_interval(hours => p_cooldown_hours),
                  last_evaluated_at = now()
              WHERE id = v_existing.id;
          END IF;
        ELSE
          IF v_guard = 'none' THEN v_guard := 'hysteresis_pending'; END IF;
          IF NOT p_dry_run THEN
            UPDATE public.notification_adaptive_policies
              SET pending_strategy = v_proposed,
                  pending_reasons = v_reasons,
                  consecutive_proposals = CASE WHEN v_existing.pending_strategy = v_proposed THEN v_existing.consecutive_proposals + 1 ELSE 1 END,
                  sample_size = v_row.sent,
                  last_evaluated_at = now()
              WHERE id = v_existing.id;
          END IF;
        END IF;
      END IF;
    END IF;

    IF NOT p_dry_run THEN
      INSERT INTO public.notification_policy_decisions
        (intent_key, persona, channel, window_hours, sample_size, current_strategy, proposed_strategy, applied_strategy, reasons, metrics, guard_action, decided_by)
      VALUES
        (v_row.intent_key, v_row.persona, v_row.channel, p_window_hours, v_row.sent,
         COALESCE(v_existing.strategy,'neutral'), v_proposed, v_applied, v_reasons,
         jsonb_build_object(
           'open_rate', v_row.open_rate,
           'resolved_rate', v_row.resolved_rate,
           'recovery_lift', v_row.recovery_lift,
           'anomaly_flags', v_row.anomaly_flags,
           'best_alt_channel', v_best_channel,
           'best_alt_resolved_rate', v_best_resolved
         ),
         v_guard, 'engine');
    END IF;

    intent_key := v_row.intent_key;
    persona := v_row.persona;
    channel := v_row.channel;
    current_strategy := COALESCE(v_existing.strategy,'neutral');
    proposed_strategy := v_proposed;
    applied_strategy := v_applied;
    reasons := v_reasons;
    guard_action := v_guard;
    sample_size := v_row.sent;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_recompute_adaptive_policies(integer, boolean, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recompute_adaptive_policies(integer, boolean, integer, integer, integer) TO authenticated;

-- 5) Resolver (service_role only; consumed by senders)
CREATE OR REPLACE FUNCTION public.resolve_notification_policy(
  p_intent_key text,
  p_persona text DEFAULT 'all',
  p_channel text DEFAULT 'push'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy public.notification_adaptive_policies%ROWTYPE;
  v_intent public.notification_intent_registry%ROWTYPE;
  v_effective text;
BEGIN
  SELECT * INTO v_intent FROM public.notification_intent_registry WHERE intent_key = p_intent_key;
  IF NOT FOUND OR NOT v_intent.enabled THEN
    RETURN jsonb_build_object('strategy','suppress','reasons',jsonb_build_array('intent_disabled_or_missing'),'safety_class','standard');
  END IF;

  SELECT * INTO v_policy
    FROM public.notification_adaptive_policies
    WHERE intent_key = p_intent_key
      AND persona IN (p_persona,'all')
      AND channel = p_channel
    ORDER BY (persona = p_persona) DESC
    LIMIT 1;

  v_effective := COALESCE(v_policy.strategy,'neutral');

  -- Enforce safety floor at read time as well (defense in depth)
  IF v_intent.safety_class = 'critical' AND v_effective IN ('downrank','cooldown','suppress') THEN
    v_effective := CASE WHEN v_intent.min_delivery_floor = 'prefer' THEN 'prefer' ELSE 'neutral' END;
  ELSIF v_intent.safety_class = 'sensitive' AND v_effective = 'suppress' THEN
    v_effective := 'downrank';
  END IF;

  RETURN jsonb_build_object(
    'strategy', v_effective,
    'raw_strategy', COALESCE(v_policy.strategy,'neutral'),
    'reasons', COALESCE(v_policy.reasons,'[]'::jsonb),
    'safety_class', v_intent.safety_class,
    'min_delivery_floor', v_intent.min_delivery_floor,
    'active_since', v_policy.active_since,
    'cooldown_until', v_policy.cooldown_until
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_notification_policy(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_notification_policy(text, text, text) TO service_role;

-- 6) Admin read RPCs for UI
CREATE OR REPLACE FUNCTION public.admin_get_adaptive_policies()
RETURNS TABLE (
  intent_key text,
  safety_class text,
  persona text,
  channel text,
  strategy text,
  reasons jsonb,
  pending_strategy text,
  pending_reasons jsonb,
  consecutive_proposals integer,
  sample_size integer,
  active_since timestamptz,
  cooldown_until timestamptz,
  last_evaluated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.intent_key, r.safety_class, p.persona, p.channel, p.strategy, p.reasons,
         p.pending_strategy, p.pending_reasons, p.consecutive_proposals, p.sample_size,
         p.active_since, p.cooldown_until, p.last_evaluated_at
  FROM public.notification_adaptive_policies p
  JOIN public.notification_intent_registry r USING (intent_key)
  WHERE public.has_role(auth.uid(),'admin')
  ORDER BY r.safety_class DESC, p.intent_key, p.persona, p.channel;
$$;

REVOKE ALL ON FUNCTION public.admin_get_adaptive_policies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_adaptive_policies() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_policy_decisions(p_limit integer DEFAULT 200)
RETURNS SETOF public.notification_policy_decisions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.notification_policy_decisions
  WHERE public.has_role(auth.uid(),'admin')
  ORDER BY decided_at DESC
  LIMIT COALESCE(p_limit, 200);
$$;

REVOKE ALL ON FUNCTION public.admin_get_policy_decisions(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_policy_decisions(integer) TO authenticated;
