
-- Tables already created from partial migration success check
-- Re-create everything cleanly

-- Drop if partially created
DROP FUNCTION IF EXISTS public.get_org_intervention_summary(uuid);
DROP FUNCTION IF EXISTS public.resolve_org_intervention(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_org_interventions(uuid, text, text);
DROP FUNCTION IF EXISTS public.scan_org_interventions(uuid, uuid);
DROP TABLE IF EXISTS public.org_intervention_events;
DROP TABLE IF EXISTS public.org_interventions;
DROP TABLE IF EXISTS public.org_intervention_rules;

-- 1. org_intervention_rules
CREATE TABLE public.org_intervention_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','paused','archived')),
  trigger_type text NOT NULL CHECK (trigger_type IN ('high_risk','inactive_days','low_readiness','score_drop','exam_fail_pattern','not_started')),
  threshold_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type text NOT NULL CHECK (action_type IN ('notify_learner','notify_org_admin','recommend_training','create_followup','escalate')),
  cooldown_days integer NOT NULL DEFAULT 7,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_intervention_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "srv_full_intervention_rules" ON public.org_intervention_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "org_admin_read_rules" ON public.org_intervention_rules FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.org_memberships om WHERE om.org_id = org_intervention_rules.org_id AND om.user_id = auth.uid() AND om.role IN ('owner','admin','manager')));

-- 2. org_interventions
CREATE TABLE public.org_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid,
  product_id uuid REFERENCES public.products(id),
  source_rule_id uuid REFERENCES public.org_intervention_rules(id),
  intervention_type text NOT NULL CHECK (intervention_type IN ('notify_learner','notify_org_admin','recommend_training','create_followup','escalate')),
  trigger_type text NOT NULL CHECK (trigger_type IN ('high_risk','inactive_days','low_readiness','score_drop','exam_fail_pattern','not_started')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','sent','acknowledged','resolved','dismissed')),
  title text NOT NULL,
  message text NOT NULL,
  recommendation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX idx_interventions_org ON public.org_interventions(org_id);
CREATE INDEX idx_interventions_status ON public.org_interventions(status);
CREATE INDEX idx_interventions_dedupe ON public.org_interventions(dedupe_key);

ALTER TABLE public.org_interventions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "srv_full_interventions" ON public.org_interventions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "org_admin_read_interventions" ON public.org_interventions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.org_memberships om WHERE om.org_id = org_interventions.org_id AND om.user_id = auth.uid() AND om.role IN ('owner','admin','manager')));
CREATE POLICY "org_admin_update_interventions" ON public.org_interventions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.org_memberships om WHERE om.org_id = org_interventions.org_id AND om.user_id = auth.uid() AND om.role IN ('owner','admin','manager')));

-- 3. org_intervention_events
CREATE TABLE public.org_intervention_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id uuid NOT NULL REFERENCES public.org_interventions(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created','sent','viewed','acknowledged','resolved','dismissed','retriggered')),
  actor_user_id uuid,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_intervention_events_int ON public.org_intervention_events(intervention_id);

ALTER TABLE public.org_intervention_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "srv_full_intervention_events" ON public.org_intervention_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "org_admin_read_events" ON public.org_intervention_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.org_interventions oi JOIN public.org_memberships om ON om.org_id = oi.org_id WHERE oi.id = org_intervention_events.intervention_id AND om.user_id = auth.uid() AND om.role IN ('owner','admin','manager')));
CREATE POLICY "org_admin_insert_events" ON public.org_intervention_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.org_interventions oi JOIN public.org_memberships om ON om.org_id = oi.org_id WHERE oi.id = org_intervention_events.intervention_id AND om.user_id = auth.uid() AND om.role IN ('owner','admin','manager')));

-- 4. scan_org_interventions
CREATE OR REPLACE FUNCTION public.scan_org_interventions(
  p_org_id uuid,
  p_product_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
  v_dedupe text;
  v_exists boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_memberships WHERE org_id = p_org_id AND user_id = auth.uid() AND role IN ('owner','admin','manager')
  ) THEN
    RETURN json_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  FOR v_row IN SELECT * FROM public.get_org_performance_dashboard(p_org_id, p_product_id)
  LOOP
    -- Rule A: Inactive > 14 days
    IF v_row.inactive_days > 14 THEN
      v_dedupe := 'inactive_' || v_row.user_id || '_' || COALESCE(v_row.product_id::text, 'all');
      SELECT EXISTS (SELECT 1 FROM public.org_interventions WHERE dedupe_key = v_dedupe AND status IN ('open','sent') AND created_at > now() - interval '7 days') INTO v_exists;
      IF NOT v_exists THEN
        INSERT INTO public.org_interventions (org_id, user_id, product_id, intervention_type, trigger_type, severity, title, message, recommendation_json, context_json, dedupe_key)
        VALUES (p_org_id, v_row.user_id, v_row.product_id, 'notify_org_admin', 'inactive_days',
          CASE WHEN v_row.inactive_days > 30 THEN 'critical' ELSE 'high' END,
          v_row.display_name || ' ist seit ' || v_row.inactive_days || ' Tagen inaktiv',
          v_row.display_name || ' hat seit ' || v_row.inactive_days || ' Tagen keine Lernaktivität im Produkt ' || COALESCE(v_row.product_title, '–') || '. Prüfungsreife: ' || ROUND(v_row.readiness_score) || '%.',
          json_build_object('recommendation_type', 'contact_learner', 'reason', 'Inaktivität über ' || v_row.inactive_days || ' Tage')::jsonb,
          json_build_object('readiness_score', v_row.readiness_score, 'inactive_days', v_row.inactive_days)::jsonb,
          v_dedupe);
        v_count := v_count + 1;
      END IF;
    END IF;

    -- Rule B: High risk (not inactive)
    IF v_row.risk_level = 'high' AND v_row.inactive_days <= 14 THEN
      v_dedupe := 'high_risk_' || v_row.user_id || '_' || COALESCE(v_row.product_id::text, 'all');
      SELECT EXISTS (SELECT 1 FROM public.org_interventions WHERE dedupe_key = v_dedupe AND status IN ('open','sent') AND created_at > now() - interval '7 days') INTO v_exists;
      IF NOT v_exists THEN
        INSERT INTO public.org_interventions (org_id, user_id, product_id, intervention_type, trigger_type, severity, title, message, recommendation_json, context_json, dedupe_key)
        VALUES (p_org_id, v_row.user_id, v_row.product_id, 'recommend_training', 'high_risk', 'high',
          v_row.display_name || ' hat hohes Durchfallrisiko',
          v_row.display_name || ' liegt bei ' || ROUND(v_row.readiness_score) || '% Prüfungsreife im Produkt ' || COALESCE(v_row.product_title, '–') || '. Empfehlung: Schwächen gezielt trainieren.',
          json_build_object('recommendation_type', 'training_path', 'reason', 'Prüfungsreife unter 40%')::jsonb,
          json_build_object('readiness_score', v_row.readiness_score, 'risk_level', v_row.risk_level)::jsonb,
          v_dedupe);
        v_count := v_count + 1;
      END IF;
    END IF;

    -- Rule C: Not started
    IF v_row.progress_pct < 5 AND v_row.readiness_score < 10 THEN
      v_dedupe := 'not_started_' || v_row.user_id || '_' || COALESCE(v_row.product_id::text, 'all');
      SELECT EXISTS (SELECT 1 FROM public.org_interventions WHERE dedupe_key = v_dedupe AND status IN ('open','sent') AND created_at > now() - interval '14 days') INTO v_exists;
      IF NOT v_exists THEN
        INSERT INTO public.org_interventions (org_id, user_id, product_id, intervention_type, trigger_type, severity, title, message, recommendation_json, context_json, dedupe_key)
        VALUES (p_org_id, v_row.user_id, v_row.product_id, 'notify_learner', 'not_started', 'medium',
          v_row.display_name || ' hat noch nicht begonnen',
          v_row.display_name || ' hat einen aktiven Seat für ' || COALESCE(v_row.product_title, '–') || ', aber noch kein Training gestartet.',
          json_build_object('recommendation_type', 'onboarding', 'reason', 'Kein Fortschritt trotz aktivem Seat')::jsonb,
          json_build_object('progress_pct', v_row.progress_pct, 'readiness_score', v_row.readiness_score)::jsonb,
          v_dedupe);
        v_count := v_count + 1;
      END IF;
    END IF;

    -- Rule D: Low readiness (medium risk, < 50)
    IF v_row.risk_level = 'medium' AND v_row.readiness_score < 50 AND v_row.inactive_days <= 14 AND v_row.progress_pct >= 5 THEN
      v_dedupe := 'low_readiness_' || v_row.user_id || '_' || COALESCE(v_row.product_id::text, 'all');
      SELECT EXISTS (SELECT 1 FROM public.org_interventions WHERE dedupe_key = v_dedupe AND status IN ('open','sent') AND created_at > now() - interval '14 days') INTO v_exists;
      IF NOT v_exists THEN
        INSERT INTO public.org_interventions (org_id, user_id, product_id, intervention_type, trigger_type, severity, title, message, recommendation_json, context_json, dedupe_key)
        VALUES (p_org_id, v_row.user_id, v_row.product_id, 'recommend_training', 'low_readiness', 'medium',
          v_row.display_name || ' braucht gezieltes Training',
          v_row.display_name || ' liegt bei ' || ROUND(v_row.readiness_score) || '% Prüfungsreife. Mit gezieltem Training kann die Bestehensquote verbessert werden.',
          json_build_object('recommendation_type', 'focused_training', 'reason', 'Prüfungsreife unter 50%')::jsonb,
          json_build_object('readiness_score', v_row.readiness_score, 'progress_pct', v_row.progress_pct)::jsonb,
          v_dedupe);
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN json_build_object('success', true, 'interventions_created', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.scan_org_interventions(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.scan_org_interventions(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_org_interventions(uuid, uuid) TO service_role;

-- 5. get_org_interventions
CREATE OR REPLACE FUNCTION public.get_org_interventions(
  p_org_id uuid,
  p_status text DEFAULT NULL,
  p_severity text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, org_id uuid, user_id uuid, display_name text,
  product_id uuid, product_title text, intervention_type text,
  trigger_type text, severity text, status text, title text,
  message text, recommendation_json jsonb, context_json jsonb,
  created_at timestamptz, resolved_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT oi.id, oi.org_id, oi.user_id, COALESCE(p.full_name, 'Unbekannt'),
    oi.product_id, pr.title, oi.intervention_type, oi.trigger_type,
    oi.severity, oi.status, oi.title, oi.message,
    oi.recommendation_json, oi.context_json, oi.created_at, oi.resolved_at
  FROM public.org_interventions oi
  LEFT JOIN public.profiles p ON p.id = oi.user_id
  LEFT JOIN public.products pr ON pr.id = oi.product_id
  WHERE oi.org_id = p_org_id
    AND (p_status IS NULL OR oi.status = p_status)
    AND (p_severity IS NULL OR oi.severity = p_severity)
    AND EXISTS (SELECT 1 FROM public.org_memberships om WHERE om.org_id = p_org_id AND om.user_id = auth.uid() AND om.role IN ('owner','admin','manager'))
  ORDER BY CASE oi.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, oi.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_org_interventions(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_org_interventions(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_interventions(uuid, text, text) TO service_role;

-- 6. resolve_org_intervention
CREATE OR REPLACE FUNCTION public.resolve_org_intervention(
  p_intervention_id uuid,
  p_action text DEFAULT 'resolved',
  p_note text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_int record;
BEGIN
  SELECT * INTO v_int FROM public.org_interventions WHERE id = p_intervention_id;
  IF v_int IS NULL THEN RETURN json_build_object('success', false, 'message', 'Not found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_memberships WHERE org_id = v_int.org_id AND user_id = auth.uid() AND role IN ('owner','admin','manager')) THEN
    RETURN json_build_object('success', false, 'message', 'Unauthorized');
  END IF;
  IF p_action NOT IN ('resolved','dismissed','acknowledged') THEN RETURN json_build_object('success', false, 'message', 'Invalid action'); END IF;

  UPDATE public.org_interventions SET status = p_action, resolved_at = CASE WHEN p_action IN ('resolved','dismissed') THEN now() ELSE resolved_at END, updated_at = now() WHERE id = p_intervention_id;
  INSERT INTO public.org_intervention_events (intervention_id, event_type, actor_user_id, metadata_json) VALUES (p_intervention_id, p_action, auth.uid(), COALESCE(json_build_object('note', p_note)::jsonb, '{}'::jsonb));
  RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_org_intervention(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_org_intervention(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_org_intervention(uuid, text, text) TO service_role;

-- 7. get_org_intervention_summary
CREATE OR REPLACE FUNCTION public.get_org_intervention_summary(p_org_id uuid)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'total_open', COUNT(*) FILTER (WHERE status IN ('open','sent')),
    'critical_count', COUNT(*) FILTER (WHERE status IN ('open','sent') AND severity = 'critical'),
    'high_count', COUNT(*) FILTER (WHERE status IN ('open','sent') AND severity = 'high'),
    'medium_count', COUNT(*) FILTER (WHERE status IN ('open','sent') AND severity = 'medium'),
    'resolved_this_week', COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at > now() - interval '7 days'),
    'created_today', COUNT(*) FILTER (WHERE created_at > now() - interval '1 day')
  )
  FROM public.org_interventions
  WHERE org_id = p_org_id
    AND EXISTS (SELECT 1 FROM public.org_memberships om WHERE om.org_id = p_org_id AND om.user_id = auth.uid() AND om.role IN ('owner','admin','manager'));
$$;

REVOKE ALL ON FUNCTION public.get_org_intervention_summary(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_org_intervention_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_intervention_summary(uuid) TO service_role;
