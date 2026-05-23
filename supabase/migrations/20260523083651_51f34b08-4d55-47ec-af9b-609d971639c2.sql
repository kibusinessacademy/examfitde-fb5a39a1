
-- ============================================================
-- P19 Growth Intelligence Layer — Foundation
-- ============================================================

CREATE TABLE public.gil_competitor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text,
  category text,
  priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  monitoring_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);
CREATE INDEX idx_gil_competitor_profiles_active ON public.gil_competitor_profiles(is_active, priority);

CREATE TABLE public.gil_market_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type text NOT NULL,
  source text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  competitor_id uuid REFERENCES public.gil_competitor_profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  summary text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','linked','dismissed')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gil_market_signals_recent ON public.gil_market_signals(observed_at DESC);
CREATE INDEX idx_gil_market_signals_severity ON public.gil_market_signals(severity, status, observed_at DESC);

CREATE TABLE public.gil_research_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  scope text NOT NULL DEFAULT 'global',
  finding text NOT NULL,
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  contributed_by text NOT NULL DEFAULT 'system',
  superseded_by uuid REFERENCES public.gil_research_memory(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gil_research_memory_topic ON public.gil_research_memory(topic, created_at DESC);

CREATE TABLE public.gil_agent_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_kind text NOT NULL CHECK (agent_kind IN (
    'product_intelligence','marketing_intelligence','seo_intelligence',
    'social_intelligence','funnel_intelligence','executive_director'
  )),
  insight_type text NOT NULL,
  title text NOT NULL,
  summary text,
  score numeric CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  related_signal_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acted','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gil_agent_insights_agent ON public.gil_agent_insights(agent_kind, created_at DESC);
CREATE INDEX idx_gil_agent_insights_severity ON public.gil_agent_insights(severity, status);

CREATE TABLE public.gil_growth_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_kind text NOT NULL DEFAULT 'executive' CHECK (briefing_kind IN ('executive','weekly','adhoc')),
  headline text NOT NULL,
  narrative text,
  opportunities jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_insight_ids uuid[] NOT NULL DEFAULT '{}',
  generated_by text NOT NULL DEFAULT 'executive_director',
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gil_growth_briefings_recent ON public.gil_growth_briefings(created_at DESC);

ALTER TABLE public.gil_competitor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gil_market_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gil_research_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gil_agent_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gil_growth_briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gil_competitor_profiles admin read" ON public.gil_competitor_profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "gil_market_signals admin read" ON public.gil_market_signals
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "gil_research_memory admin read" ON public.gil_research_memory
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "gil_agent_insights admin read" ON public.gil_agent_insights
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "gil_growth_briefings admin read" ON public.gil_growth_briefings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));

REVOKE INSERT, UPDATE, DELETE ON public.gil_competitor_profiles FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.gil_market_signals FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.gil_research_memory FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.gil_agent_insights FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.gil_growth_briefings FROM authenticated, anon;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('gil_market_signal_recorded', ARRAY['signal_type','source','severity'], 'gil'),
  ('gil_agent_insight_recorded', ARRAY['agent_kind','insight_type','severity'], 'gil'),
  ('gil_growth_briefing_recorded', ARRAY['briefing_kind','headline'], 'gil'),
  ('gil_executive_briefing_requested', ARRAY['reason','dry_run'], 'gil')
ON CONFLICT (action_type) DO NOTHING;

-- Read RPCs
CREATE OR REPLACE FUNCTION public.admin_get_growth_intelligence_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'competitors_total', (SELECT COUNT(*) FROM public.gil_competitor_profiles WHERE is_active),
    'signals_24h', (SELECT COUNT(*) FROM public.gil_market_signals WHERE observed_at > now() - interval '24 hours'),
    'signals_critical_open', (SELECT COUNT(*) FROM public.gil_market_signals WHERE severity='critical' AND status='new'),
    'insights_open', (SELECT COUNT(*) FROM public.gil_agent_insights WHERE status='open'),
    'insights_by_agent', COALESCE((
      SELECT jsonb_object_agg(agent_kind, c) FROM (
        SELECT agent_kind, COUNT(*)::int AS c FROM public.gil_agent_insights
        WHERE created_at > now() - interval '7 days' GROUP BY agent_kind
      ) t), '{}'::jsonb),
    'briefings_total', (SELECT COUNT(*) FROM public.gil_growth_briefings),
    'last_briefing_at', (SELECT MAX(created_at) FROM public.gil_growth_briefings),
    'generated_at', now()
  ) INTO v_result;
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_get_growth_briefings(p_limit int DEFAULT 10)
RETURNS SETOF public.gil_growth_briefings LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.gil_growth_briefings ORDER BY created_at DESC LIMIT GREATEST(1, LEAST(p_limit,100));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_get_market_signals(p_limit int DEFAULT 50, p_severity text DEFAULT NULL)
RETURNS SETOF public.gil_market_signals LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.gil_market_signals
    WHERE p_severity IS NULL OR severity = p_severity
    ORDER BY observed_at DESC LIMIT GREATEST(1, LEAST(p_limit,500));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_get_competitor_profiles()
RETURNS SETOF public.gil_competitor_profiles LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.gil_competitor_profiles ORDER BY priority ASC, name ASC;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_get_agent_insights(p_agent_kind text DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS SETOF public.gil_agent_insights LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.gil_agent_insights
    WHERE p_agent_kind IS NULL OR agent_kind = p_agent_kind
    ORDER BY created_at DESC LIMIT GREATEST(1, LEAST(p_limit,500));
END; $$;

-- Write RPCs (service_role only)
CREATE OR REPLACE FUNCTION public.admin_record_market_signal(
  p_signal_type text, p_source text, p_severity text, p_title text,
  p_summary text DEFAULT NULL, p_competitor_id uuid DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF current_setting('role') NOT IN ('service_role','postgres') THEN RAISE EXCEPTION 'forbidden: service_role only'; END IF;
  INSERT INTO public.gil_market_signals(signal_type, source, severity, title, summary, competitor_id, payload)
  VALUES (p_signal_type, p_source, COALESCE(p_severity,'info'), p_title, p_summary, p_competitor_id, COALESCE(p_payload,'{}'::jsonb))
  RETURNING id INTO v_id;
  PERFORM public.fn_emit_audit('gil_market_signal_recorded',
    jsonb_build_object('signal_type', p_signal_type, 'source', p_source, 'severity', COALESCE(p_severity,'info'), 'signal_id', v_id),
    'system', v_id::text, 'success');
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_record_agent_insight(
  p_agent_kind text, p_insight_type text, p_title text, p_severity text DEFAULT 'info',
  p_summary text DEFAULT NULL, p_score numeric DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb,
  p_related_signal_ids uuid[] DEFAULT '{}'::uuid[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF current_setting('role') NOT IN ('service_role','postgres') THEN RAISE EXCEPTION 'forbidden: service_role only'; END IF;
  INSERT INTO public.gil_agent_insights(agent_kind, insight_type, title, severity, summary, score, payload, related_signal_ids)
  VALUES (p_agent_kind, p_insight_type, p_title, COALESCE(p_severity,'info'), p_summary, p_score, COALESCE(p_payload,'{}'::jsonb), COALESCE(p_related_signal_ids,'{}'::uuid[]))
  RETURNING id INTO v_id;
  PERFORM public.fn_emit_audit('gil_agent_insight_recorded',
    jsonb_build_object('agent_kind', p_agent_kind, 'insight_type', p_insight_type, 'severity', COALESCE(p_severity,'info'), 'insight_id', v_id),
    'system', v_id::text, 'success');
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_record_growth_briefing(
  p_briefing_kind text, p_headline text, p_narrative text,
  p_opportunities jsonb, p_risks jsonb, p_recommendations jsonb,
  p_context_snapshot jsonb, p_source_insight_ids uuid[], p_generated_by text, p_model text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF current_setting('role') NOT IN ('service_role','postgres') THEN RAISE EXCEPTION 'forbidden: service_role only'; END IF;
  INSERT INTO public.gil_growth_briefings(briefing_kind, headline, narrative, opportunities, risks, recommendations, context_snapshot, source_insight_ids, generated_by, model)
  VALUES (COALESCE(p_briefing_kind,'executive'), p_headline, p_narrative,
    COALESCE(p_opportunities,'[]'::jsonb), COALESCE(p_risks,'[]'::jsonb), COALESCE(p_recommendations,'[]'::jsonb),
    COALESCE(p_context_snapshot,'{}'::jsonb), COALESCE(p_source_insight_ids,'{}'::uuid[]),
    COALESCE(p_generated_by,'executive_director'), p_model)
  RETURNING id INTO v_id;
  PERFORM public.fn_emit_audit('gil_growth_briefing_recorded',
    jsonb_build_object('briefing_kind', COALESCE(p_briefing_kind,'executive'), 'headline', p_headline, 'briefing_id', v_id),
    'system', v_id::text, 'success');
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_run_executive_briefing(p_reason text, p_dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_now timestamptz := now();
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF coalesce(length(trim(p_reason)),0) < 8 THEN RAISE EXCEPTION 'reason must be at least 8 characters'; END IF;
  PERFORM public.fn_emit_audit('gil_executive_briefing_requested',
    jsonb_build_object('reason', p_reason, 'dry_run', p_dry_run, 'requested_at', v_now),
    'governance', NULL, 'success');
  RETURN jsonb_build_object('ok', true, 'requested_at', v_now, 'dry_run', p_dry_run);
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_record_market_signal(text,text,text,text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_record_agent_insight(text,text,text,text,text,numeric,jsonb,uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_record_growth_briefing(text,text,text,jsonb,jsonb,jsonb,jsonb,uuid[],text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_market_signal(text,text,text,text,text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_agent_insight(text,text,text,text,text,numeric,jsonb,uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_growth_briefing(text,text,text,jsonb,jsonb,jsonb,jsonb,uuid[],text,text) TO service_role;

GRANT EXECUTE ON FUNCTION public.admin_get_growth_intelligence_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_briefings(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_market_signals(int,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_competitor_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_agent_insights(text,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_run_executive_briefing(text,boolean) TO authenticated;
