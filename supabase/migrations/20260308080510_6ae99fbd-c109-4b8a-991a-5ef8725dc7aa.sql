
-- 1. OPTIMIZATION RUNS
CREATE TABLE IF NOT EXISTS public.optimization_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  processed_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE OR REPLACE FUNCTION public.trg_validate_optimization_runs_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('running','done','failed') THEN RAISE EXCEPTION 'Invalid status: %', NEW.status; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_optimization_runs_status ON public.optimization_runs;
CREATE TRIGGER validate_optimization_runs_status
  BEFORE INSERT OR UPDATE ON public.optimization_runs
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_optimization_runs_status();

-- 2. OBSERVATIONS
CREATE TABLE IF NOT EXISTS public.optimization_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_plan_id uuid REFERENCES public.campaign_launch_plans(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.campaign_assets(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  channel_key text,
  observation_type text NOT NULL,
  observation_score numeric NOT NULL DEFAULT 0,
  observation_label text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.trg_validate_optimization_observations_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.observation_type NOT IN (
    'high_ctr','low_ctr','high_conversion','low_conversion',
    'high_revenue','low_revenue','high_lead_rate','low_lead_rate',
    'winning_angle','weak_angle','channel_fit','channel_mismatch',
    'curriculum_scale_signal','curriculum_pause_signal'
  ) THEN RAISE EXCEPTION 'Invalid observation_type: %', NEW.observation_type; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_optimization_observations_type ON public.optimization_observations;
CREATE TRIGGER validate_optimization_observations_type
  BEFORE INSERT OR UPDATE ON public.optimization_observations
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_optimization_observations_type();

CREATE INDEX IF NOT EXISTS idx_optimization_observations_lookup
  ON public.optimization_observations (launch_plan_id, asset_id, curriculum_id, channel_key, created_at DESC);

-- 3. ASSET OPTIMIZATION SCORES
CREATE TABLE IF NOT EXISTS public.asset_optimization_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.campaign_assets(id) ON DELETE CASCADE,
  launch_plan_id uuid REFERENCES public.campaign_launch_plans(id) ON DELETE CASCADE,
  channel_key text,
  ctr_score numeric NOT NULL DEFAULT 0,
  lead_score numeric NOT NULL DEFAULT 0,
  conversion_score numeric NOT NULL DEFAULT 0,
  revenue_score numeric NOT NULL DEFAULT 0,
  efficiency_score numeric NOT NULL DEFAULT 0,
  overall_score numeric NOT NULL DEFAULT 0,
  optimization_status text NOT NULL DEFAULT 'observe',
  recommended_action text NOT NULL DEFAULT 'keep_running',
  reasoning jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.trg_validate_asset_optimization_scores()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.optimization_status NOT IN ('winner','promising','weak','failing','observe') THEN
    RAISE EXCEPTION 'Invalid optimization_status: %', NEW.optimization_status;
  END IF;
  IF NEW.recommended_action NOT IN ('scale','replicate','refresh_copy','change_angle','pause','keep_running') THEN
    RAISE EXCEPTION 'Invalid recommended_action: %', NEW.recommended_action;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_asset_optimization_scores ON public.asset_optimization_scores;
CREATE TRIGGER validate_asset_optimization_scores
  BEFORE INSERT OR UPDATE ON public.asset_optimization_scores
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_asset_optimization_scores();

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_optimization_scores_asset
  ON public.asset_optimization_scores (asset_id);

-- 4. CURRICULUM SCALING SIGNALS
CREATE TABLE IF NOT EXISTS public.curriculum_scaling_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  avg_asset_score numeric NOT NULL DEFAULT 0,
  avg_channel_fit_score numeric NOT NULL DEFAULT 0,
  revenue_signal_score numeric NOT NULL DEFAULT 0,
  replication_score numeric NOT NULL DEFAULT 0,
  scale_decision text NOT NULL DEFAULT 'hold',
  reasoning jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.trg_validate_curriculum_scaling_signals()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scale_decision NOT IN ('scale_now','replicate_assets','refresh_campaign','hold','pause') THEN
    RAISE EXCEPTION 'Invalid scale_decision: %', NEW.scale_decision;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_curriculum_scaling_signals ON public.curriculum_scaling_signals;
CREATE TRIGGER validate_curriculum_scaling_signals
  BEFORE INSERT OR UPDATE ON public.curriculum_scaling_signals
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_curriculum_scaling_signals();

CREATE UNIQUE INDEX IF NOT EXISTS uq_curriculum_scaling_signals_qc
  ON public.curriculum_scaling_signals (qualification_catalog_id);

-- 5. OPTIMIZATION ACTIONS
CREATE TABLE IF NOT EXISTS public.optimization_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_scope text NOT NULL,
  asset_id uuid REFERENCES public.campaign_assets(id) ON DELETE CASCADE,
  launch_plan_id uuid REFERENCES public.campaign_launch_plans(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  priority integer NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'queued',
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);

CREATE OR REPLACE FUNCTION public.trg_validate_optimization_actions()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action_scope NOT IN ('asset','curriculum','launch_plan') THEN
    RAISE EXCEPTION 'Invalid action_scope: %', NEW.action_scope;
  END IF;
  IF NEW.action_type NOT IN (
    'scale_asset','replicate_asset','refresh_copy','change_angle',
    'pause_asset','scale_curriculum','replicate_campaign',
    'refresh_launch_plan','pause_curriculum'
  ) THEN RAISE EXCEPTION 'Invalid action_type: %', NEW.action_type; END IF;
  IF NEW.status NOT IN ('queued','processing','done','failed','skipped') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_optimization_actions ON public.optimization_actions;
CREATE TRIGGER validate_optimization_actions
  BEFORE INSERT OR UPDATE ON public.optimization_actions
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_optimization_actions();

CREATE INDEX IF NOT EXISTS idx_optimization_actions_lookup
  ON public.optimization_actions (status, priority DESC, created_at ASC);

-- 6. CHANNEL PERFORMANCE PROFILES
CREATE TABLE IF NOT EXISTS public.channel_performance_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_key text NOT NULL UNIQUE,
  avg_ctr numeric NOT NULL DEFAULT 0,
  avg_lead_rate numeric NOT NULL DEFAULT 0,
  avg_conversion_rate numeric NOT NULL DEFAULT 0,
  avg_revenue_per_asset numeric NOT NULL DEFAULT 0,
  channel_fit_score numeric NOT NULL DEFAULT 0,
  best_asset_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  worst_asset_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 7. SCORE A SINGLE ASSET
CREATE OR REPLACE FUNCTION public.compute_asset_optimization_score(
  p_asset_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset record;
  v_impressions numeric := 0;
  v_clicks numeric := 0;
  v_leads numeric := 0;
  v_purchases numeric := 0;
  v_revenue numeric := 0;
  v_ctr numeric := 0;
  v_lead_rate numeric := 0;
  v_conversion_rate numeric := 0;
  v_ctr_score numeric := 0;
  v_lead_score numeric := 0;
  v_conversion_score numeric := 0;
  v_revenue_score numeric := 0;
  v_efficiency numeric := 0;
  v_overall numeric := 0;
  v_status text := 'observe';
  v_action text := 'keep_running';
BEGIN
  SELECT ca.id, ca.launch_plan_id, ca.channel, ca.qualification_catalog_id, ca.curriculum_id
  INTO v_asset FROM public.campaign_assets ca WHERE ca.id = p_asset_id;

  IF v_asset.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'asset_not_found');
  END IF;

  SELECT coalesce(sum(impressions),0), coalesce(sum(clicks),0), coalesce(sum(leads),0),
         coalesce(sum(purchases),0), coalesce(sum(revenue),0)
  INTO v_impressions, v_clicks, v_leads, v_purchases, v_revenue
  FROM public.campaign_performance_snapshots WHERE asset_id = p_asset_id;

  v_ctr := CASE WHEN v_impressions > 0 THEN (v_clicks / v_impressions) * 100 ELSE 0 END;
  v_lead_rate := CASE WHEN v_clicks > 0 THEN (v_leads / v_clicks) * 100 ELSE 0 END;
  v_conversion_rate := CASE WHEN v_clicks > 0 THEN (v_purchases / v_clicks) * 100 ELSE 0 END;

  v_ctr_score := least(100, v_ctr * 12);
  v_lead_score := least(100, v_lead_rate * 8);
  v_conversion_score := least(100, v_conversion_rate * 20);
  v_revenue_score := least(100, v_revenue);
  v_efficiency := (v_ctr_score * 0.25) + (v_lead_score * 0.25) + (v_conversion_score * 0.30) + (v_revenue_score * 0.20);
  v_overall := v_efficiency;

  v_status := CASE
    WHEN v_overall >= 80 THEN 'winner'
    WHEN v_overall >= 60 THEN 'promising'
    WHEN v_overall >= 35 THEN 'weak'
    WHEN v_overall > 0 THEN 'failing'
    ELSE 'observe'
  END;

  v_action := CASE
    WHEN v_overall >= 85 THEN 'replicate'
    WHEN v_overall >= 70 THEN 'scale'
    WHEN v_overall >= 45 THEN 'refresh_copy'
    WHEN v_overall > 0 THEN 'change_angle'
    ELSE 'keep_running'
  END;

  INSERT INTO public.asset_optimization_scores (
    asset_id, launch_plan_id, channel_key,
    ctr_score, lead_score, conversion_score, revenue_score,
    efficiency_score, overall_score, optimization_status, recommended_action,
    reasoning, updated_at, last_computed_at
  )
  VALUES (
    p_asset_id, v_asset.launch_plan_id, v_asset.channel,
    round(v_ctr_score,2), round(v_lead_score,2), round(v_conversion_score,2), round(v_revenue_score,2),
    round(v_efficiency,2), round(v_overall,2), v_status, v_action,
    jsonb_build_object(
      'impressions', v_impressions, 'clicks', v_clicks, 'leads', v_leads,
      'purchases', v_purchases, 'revenue', v_revenue,
      'ctr_pct', round(v_ctr,2), 'lead_rate_pct', round(v_lead_rate,2),
      'conversion_rate_pct', round(v_conversion_rate,2)
    ),
    now(), now()
  )
  ON CONFLICT (asset_id)
  DO UPDATE SET
    ctr_score = excluded.ctr_score, lead_score = excluded.lead_score,
    conversion_score = excluded.conversion_score, revenue_score = excluded.revenue_score,
    efficiency_score = excluded.efficiency_score, overall_score = excluded.overall_score,
    optimization_status = excluded.optimization_status, recommended_action = excluded.recommended_action,
    reasoning = excluded.reasoning, updated_at = now(), last_computed_at = now();

  RETURN jsonb_build_object(
    'ok', true, 'asset_id', p_asset_id,
    'overall_score', round(v_overall,2), 'optimization_status', v_status, 'recommended_action', v_action
  );
END;
$$;

-- 8. SCORE CURRICULUM SCALING
CREATE OR REPLACE FUNCTION public.compute_curriculum_scaling_signal(
  p_qualification_catalog_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg_asset_score numeric := 0;
  v_avg_channel_fit numeric := 0;
  v_revenue_signal numeric := 0;
  v_replication numeric := 0;
  v_decision text := 'hold';
BEGIN
  SELECT coalesce(avg(aos.overall_score),0) INTO v_avg_asset_score
  FROM public.asset_optimization_scores aos
  JOIN public.campaign_assets ca ON ca.id = aos.asset_id
  WHERE ca.qualification_catalog_id = p_qualification_catalog_id;

  SELECT coalesce(avg(cpp.channel_fit_score),0) INTO v_avg_channel_fit
  FROM public.channel_performance_profiles cpp
  JOIN public.campaign_assets ca ON ca.channel = cpp.channel_key
  WHERE ca.qualification_catalog_id = p_qualification_catalog_id;

  SELECT coalesce(max(cps.revenue),0) INTO v_revenue_signal
  FROM public.campaign_performance_snapshots cps
  JOIN public.campaign_assets ca ON ca.id = cps.asset_id
  WHERE ca.qualification_catalog_id = p_qualification_catalog_id;

  v_replication := (v_avg_asset_score * 0.5) + (v_avg_channel_fit * 0.2) + least(100, v_revenue_signal) * 0.3;

  v_decision := CASE
    WHEN v_replication >= 80 THEN 'scale_now'
    WHEN v_replication >= 65 THEN 'replicate_assets'
    WHEN v_replication >= 45 THEN 'refresh_campaign'
    WHEN v_replication > 0 THEN 'hold'
    ELSE 'pause'
  END;

  INSERT INTO public.curriculum_scaling_signals (
    qualification_catalog_id, curriculum_id,
    avg_asset_score, avg_channel_fit_score, revenue_signal_score,
    replication_score, scale_decision, reasoning, updated_at, last_computed_at
  )
  VALUES (
    p_qualification_catalog_id, NULL,
    round(v_avg_asset_score,2), round(v_avg_channel_fit,2),
    round(least(100, v_revenue_signal),2), round(v_replication,2),
    v_decision,
    jsonb_build_object('avg_asset_score', v_avg_asset_score, 'avg_channel_fit_score', v_avg_channel_fit, 'revenue_signal_score', v_revenue_signal),
    now(), now()
  )
  ON CONFLICT (qualification_catalog_id)
  DO UPDATE SET
    avg_asset_score = excluded.avg_asset_score, avg_channel_fit_score = excluded.avg_channel_fit_score,
    revenue_signal_score = excluded.revenue_signal_score, replication_score = excluded.replication_score,
    scale_decision = excluded.scale_decision, reasoning = excluded.reasoning,
    updated_at = now(), last_computed_at = now();

  RETURN jsonb_build_object(
    'ok', true, 'qualification_catalog_id', p_qualification_catalog_id,
    'replication_score', round(v_replication,2), 'scale_decision', v_decision
  );
END;
$$;

-- RLS
ALTER TABLE public.optimization_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optimization_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_optimization_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_scaling_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optimization_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_performance_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.optimization_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.optimization_observations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.asset_optimization_scores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.curriculum_scaling_signals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.optimization_actions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.channel_performance_profiles FOR ALL USING (true) WITH CHECK (true);
