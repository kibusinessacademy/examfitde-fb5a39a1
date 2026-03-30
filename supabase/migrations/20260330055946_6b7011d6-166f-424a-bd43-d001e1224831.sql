
-- Drop function with changed return type first
DROP FUNCTION IF EXISTS public.get_org_interventions(uuid, text, text);

-- 1. Add learner_identity_id column + indexes (idempotent)
ALTER TABLE public.org_interventions
  ADD COLUMN IF NOT EXISTS learner_identity_id uuid REFERENCES public.learner_identities(id);

CREATE INDEX IF NOT EXISTS idx_org_interventions_learner_identity
  ON public.org_interventions(learner_identity_id);

CREATE INDEX IF NOT EXISTS idx_org_interventions_dedupe_open
  ON public.org_interventions(dedupe_key, created_at DESC);

-- 2. Recreate get_org_interventions with learner_identities instead of profiles
CREATE OR REPLACE FUNCTION public.get_org_interventions(
  p_org_id uuid,
  p_status text DEFAULT NULL,
  p_severity text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, org_id uuid, learner_identity_id uuid, user_id uuid, display_name text,
  product_id uuid, product_title text, intervention_type text,
  trigger_type text, severity text, status text, title text,
  message text, recommendation_json jsonb, context_json jsonb,
  created_at timestamptz, resolved_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT oi.id, oi.org_id, oi.learner_identity_id, oi.user_id,
    COALESCE(li.display_name, 'Unbekannt'),
    oi.product_id, pr.title, oi.intervention_type, oi.trigger_type,
    oi.severity, oi.status, oi.title, oi.message,
    oi.recommendation_json, oi.context_json, oi.created_at, oi.resolved_at
  FROM public.org_interventions oi
  LEFT JOIN public.learner_identities li ON li.id = oi.learner_identity_id
  LEFT JOIN public.products pr ON pr.id = oi.product_id
  WHERE oi.org_id = p_org_id
    AND (p_status IS NULL OR oi.status = p_status)
    AND (p_severity IS NULL OR oi.severity = p_severity)
    AND EXISTS (
      SELECT 1 FROM public.org_memberships om
      WHERE om.org_id = p_org_id AND om.user_id = auth.uid()
        AND om.role IN ('owner','admin','manager') AND om.status = 'active'
    )
  ORDER BY CASE oi.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, oi.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_org_interventions(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_org_interventions(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_interventions(uuid, text, text) TO service_role;

-- 3. Fix scan_org_interventions: learner_identity_id + om.status = 'active'
CREATE OR REPLACE FUNCTION public.scan_org_interventions(
  p_org_id uuid, p_product_id uuid DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record; v_count integer := 0; v_dedupe text; v_exists boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_memberships WHERE org_id = p_org_id AND user_id = auth.uid()
      AND role IN ('owner','admin','manager') AND status = 'active'
  ) THEN RETURN json_build_object('success', false, 'message', 'Unauthorized'); END IF;

  FOR v_row IN SELECT * FROM public.get_org_performance_dashboard(p_org_id, p_product_id) LOOP
    IF v_row.inactive_days > 14 THEN
      v_dedupe := 'inactive_' || v_row.user_id || '_' || COALESCE(v_row.product_id::text, 'all');
      SELECT EXISTS (SELECT 1 FROM public.org_interventions WHERE dedupe_key = v_dedupe AND status IN ('open','sent') AND created_at > now() - interval '7 days') INTO v_exists;
      IF NOT v_exists THEN
        INSERT INTO public.org_interventions (org_id, learner_identity_id, user_id, product_id, intervention_type, trigger_type, severity, title, message, recommendation_json, context_json, dedupe_key)
        VALUES (p_org_id, v_row.learner_identity_id, v_row.user_id, v_row.product_id, 'notify_org_admin', 'inactive_days',
          CASE WHEN v_row.inactive_days > 30 THEN 'critical' ELSE 'high' END,
          v_row.display_name || ' ist seit ' || v_row.inactive_days || ' Tagen inaktiv',
          v_row.display_name || ' hat seit ' || v_row.inactive_days || ' Tagen keine Lernaktivität im Produkt ' || COALESCE(v_row.product_title, '–') || '. Prüfungsreife: ' || ROUND(v_row.readiness_score) || '%.',
          json_build_object('recommendation_type', 'contact_learner', 'reason', 'Inaktivität über ' || v_row.inactive_days || ' Tage')::jsonb,
          json_build_object('readiness_score', v_row.readiness_score, 'inactive_days', v_row.inactive_days)::jsonb, v_dedupe);
        v_count := v_count + 1;
      END IF;
    END IF;

    IF v_row.risk_level = 'high' AND v_row.inactive_days <= 14 THEN
      v_dedupe := 'high_risk_' || v_row.user_id || '_' || COALESCE(v_row.product_id::text, 'all');
      SELECT EXISTS (SELECT 1 FROM public.org_interventions WHERE dedupe_key = v_dedupe AND status IN ('open','sent') AND created_at > now() - interval '7 days') INTO v_exists;
      IF NOT v_exists THEN
        INSERT INTO public.org_interventions (org_id, learner_identity_id, user_id, product_id, intervention_type, trigger_type, severity, title, message, recommendation_json, context_json, dedupe_key)
        VALUES (p_org_id, v_row.learner_identity_id, v_row.user_id, v_row.product_id, 'recommend_training', 'high_risk', 'high',
          v_row.display_name || ' hat hohes Durchfallrisiko',
          v_row.display_name || ' liegt bei ' || ROUND(v_row.readiness_score) || '% Prüfungsreife im Produkt ' || COALESCE(v_row.product_title, '–') || '.',
          json_build_object('recommendation_type', 'training_path', 'reason', 'Prüfungsreife unter 40%')::jsonb,
          json_build_object('readiness_score', v_row.readiness_score, 'risk_level', v_row.risk_level)::jsonb, v_dedupe);
        v_count := v_count + 1;
      END IF;
    END IF;

    IF v_row.progress_pct < 5 AND v_row.readiness_score < 10 THEN
      v_dedupe := 'not_started_' || v_row.user_id || '_' || COALESCE(v_row.product_id::text, 'all');
      SELECT EXISTS (SELECT 1 FROM public.org_interventions WHERE dedupe_key = v_dedupe AND status IN ('open','sent') AND created_at > now() - interval '14 days') INTO v_exists;
      IF NOT v_exists THEN
        INSERT INTO public.org_interventions (org_id, learner_identity_id, user_id, product_id, intervention_type, trigger_type, severity, title, message, recommendation_json, context_json, dedupe_key)
        VALUES (p_org_id, v_row.learner_identity_id, v_row.user_id, v_row.product_id, 'notify_learner', 'not_started', 'medium',
          v_row.display_name || ' hat noch nicht begonnen',
          v_row.display_name || ' hat einen aktiven Seat für ' || COALESCE(v_row.product_title, '–') || ', aber noch kein Training gestartet.',
          json_build_object('recommendation_type', 'onboarding', 'reason', 'Kein Fortschritt trotz aktivem Seat')::jsonb,
          json_build_object('progress_pct', v_row.progress_pct, 'readiness_score', v_row.readiness_score)::jsonb, v_dedupe);
        v_count := v_count + 1;
      END IF;
    END IF;

    IF v_row.risk_level = 'medium' AND v_row.readiness_score < 50 AND v_row.inactive_days <= 14 AND v_row.progress_pct >= 5 THEN
      v_dedupe := 'low_readiness_' || v_row.user_id || '_' || COALESCE(v_row.product_id::text, 'all');
      SELECT EXISTS (SELECT 1 FROM public.org_interventions WHERE dedupe_key = v_dedupe AND status IN ('open','sent') AND created_at > now() - interval '14 days') INTO v_exists;
      IF NOT v_exists THEN
        INSERT INTO public.org_interventions (org_id, learner_identity_id, user_id, product_id, intervention_type, trigger_type, severity, title, message, recommendation_json, context_json, dedupe_key)
        VALUES (p_org_id, v_row.learner_identity_id, v_row.user_id, v_row.product_id, 'recommend_training', 'low_readiness', 'medium',
          v_row.display_name || ' braucht gezieltes Training',
          v_row.display_name || ' liegt bei ' || ROUND(v_row.readiness_score) || '% Prüfungsreife.',
          json_build_object('recommendation_type', 'focused_training', 'reason', 'Prüfungsreife unter 50%')::jsonb,
          json_build_object('readiness_score', v_row.readiness_score, 'progress_pct', v_row.progress_pct)::jsonb, v_dedupe);
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN json_build_object('success', true, 'interventions_created', v_count);
END; $$;

REVOKE ALL ON FUNCTION public.scan_org_interventions(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.scan_org_interventions(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_org_interventions(uuid, uuid) TO service_role;

-- 4. Fix resolve with om.status = 'active'
CREATE OR REPLACE FUNCTION public.resolve_org_intervention(
  p_intervention_id uuid, p_action text DEFAULT 'resolved', p_note text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_int record;
BEGIN
  SELECT * INTO v_int FROM public.org_interventions WHERE id = p_intervention_id;
  IF v_int IS NULL THEN RETURN json_build_object('success', false, 'message', 'Not found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_memberships WHERE org_id = v_int.org_id AND user_id = auth.uid() AND role IN ('owner','admin','manager') AND status = 'active') THEN
    RETURN json_build_object('success', false, 'message', 'Unauthorized');
  END IF;
  IF p_action NOT IN ('resolved','dismissed','acknowledged') THEN RETURN json_build_object('success', false, 'message', 'Invalid action'); END IF;
  UPDATE public.org_interventions SET status = p_action, resolved_at = CASE WHEN p_action IN ('resolved','dismissed') THEN now() ELSE resolved_at END, updated_at = now() WHERE id = p_intervention_id;
  INSERT INTO public.org_intervention_events (intervention_id, event_type, actor_user_id, metadata_json) VALUES (p_intervention_id, p_action, auth.uid(), COALESCE(json_build_object('note', p_note)::jsonb, '{}'::jsonb));
  RETURN json_build_object('success', true);
END; $$;

REVOKE ALL ON FUNCTION public.resolve_org_intervention(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_org_intervention(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_org_intervention(uuid, text, text) TO service_role;

-- 5. Fix summary with om.status = 'active'
CREATE OR REPLACE FUNCTION public.get_org_intervention_summary(p_org_id uuid)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
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
    AND EXISTS (SELECT 1 FROM public.org_memberships om WHERE om.org_id = p_org_id AND om.user_id = auth.uid() AND om.role IN ('owner','admin','manager') AND om.status = 'active');
$$;

REVOKE ALL ON FUNCTION public.get_org_intervention_summary(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_org_intervention_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_intervention_summary(uuid) TO service_role;
