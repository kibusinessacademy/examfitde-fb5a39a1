
BEGIN;

-- 1. ROI DECISION RULES
CREATE TABLE IF NOT EXISTS public.roi_decision_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT true,
  threshold_numeric numeric,
  threshold_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_on_pass text NOT NULL DEFAULT 'promote',
  action_on_fail text NOT NULL DEFAULT 'hold',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roi_decision_rules_action_pass_chk CHECK (action_on_pass IN ('promote','scale','approve_wave','keep_running')),
  CONSTRAINT roi_decision_rules_action_fail_chk CHECK (action_on_fail IN ('hold','pause','block_wave','kill'))
);

INSERT INTO public.roi_decision_rules (rule_key, is_enabled, threshold_numeric, action_on_pass, action_on_fail, description)
VALUES
  ('curriculum_roi_min', true, 1.20, 'promote', 'hold', 'Minimum ROI for curriculum promotion'),
  ('channel_roi_min', true, 1.05, 'keep_running', 'pause', 'Minimum ROI for channel continuation'),
  ('wave_expected_roi_min', true, 1.15, 'approve_wave', 'block_wave', 'Minimum expected ROI before wave release'),
  ('curriculum_payback_days_max', true, 120, 'scale', 'hold', 'Max payback days for aggressive scale'),
  ('curriculum_margin_min', true, 0.25, 'promote', 'hold', 'Minimum contribution margin')
ON CONFLICT (rule_key) DO NOTHING;

-- 2. CURRICULUM UNIT ECONOMICS
CREATE TABLE IF NOT EXISTS public.curriculum_unit_economics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  production_cost_estimate numeric NOT NULL DEFAULT 0,
  campaign_cost_estimate numeric NOT NULL DEFAULT 0,
  distribution_cost_estimate numeric NOT NULL DEFAULT 0,
  optimization_cost_estimate numeric NOT NULL DEFAULT 0,
  total_cost_estimate numeric NOT NULL DEFAULT 0,
  attributed_revenue numeric NOT NULL DEFAULT 0,
  gross_margin numeric NOT NULL DEFAULT 0,
  roi numeric NOT NULL DEFAULT 0,
  payback_days numeric,
  ltv_estimate numeric NOT NULL DEFAULT 0,
  cac_estimate numeric NOT NULL DEFAULT 0,
  contribution_margin numeric NOT NULL DEFAULT 0,
  decision text NOT NULL DEFAULT 'hold',
  reasoning jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_unit_economics_decision_chk CHECK (decision IN ('promote','scale','hold','pause','kill'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_curriculum_unit_economics_qc ON public.curriculum_unit_economics (qualification_catalog_id);

-- 3. CHANNEL UNIT ECONOMICS
CREATE TABLE IF NOT EXISTS public.channel_unit_economics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_key text NOT NULL UNIQUE,
  attributed_cost numeric NOT NULL DEFAULT 0,
  attributed_revenue numeric NOT NULL DEFAULT 0,
  roi numeric NOT NULL DEFAULT 0,
  ctr numeric NOT NULL DEFAULT 0,
  lead_rate numeric NOT NULL DEFAULT 0,
  conversion_rate numeric NOT NULL DEFAULT 0,
  revenue_per_lead numeric NOT NULL DEFAULT 0,
  revenue_per_asset numeric NOT NULL DEFAULT 0,
  decision text NOT NULL DEFAULT 'hold',
  reasoning jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_unit_economics_decision_chk CHECK (decision IN ('scale','keep_running','hold','pause','kill'))
);

-- 4. WAVE GOVERNANCE DECISIONS
CREATE TABLE IF NOT EXISTS public.wave_governance_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_id uuid REFERENCES public.production_waves(id) ON DELETE CASCADE,
  decision_status text NOT NULL DEFAULT 'pending',
  expected_roi numeric NOT NULL DEFAULT 0,
  avg_priority_score numeric NOT NULL DEFAULT 0,
  avg_readiness_score numeric NOT NULL DEFAULT 0,
  blocked_item_count integer NOT NULL DEFAULT 0,
  projected_cost numeric NOT NULL DEFAULT 0,
  projected_revenue numeric NOT NULL DEFAULT 0,
  decision_reason text,
  rule_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wave_governance_decisions_status_chk CHECK (decision_status IN ('pending','approved','blocked','paused','completed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wave_governance_decisions_wave ON public.wave_governance_decisions (wave_id);

-- 5. BUSINESS KPI SNAPSHOTS
CREATE TABLE IF NOT EXISTS public.business_kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL DEFAULT current_date,
  total_revenue numeric NOT NULL DEFAULT 0,
  total_cost_estimate numeric NOT NULL DEFAULT 0,
  estimated_profit numeric NOT NULL DEFAULT 0,
  blended_roi numeric NOT NULL DEFAULT 0,
  active_curricula integer NOT NULL DEFAULT 0,
  monetized_curricula integer NOT NULL DEFAULT 0,
  active_campaigns integer NOT NULL DEFAULT 0,
  active_waves integer NOT NULL DEFAULT 0,
  blocked_waves integer NOT NULL DEFAULT 0,
  top_channel text,
  top_curriculum_id uuid,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_kpi_snapshots_date ON public.business_kpi_snapshots (snapshot_date DESC);

-- 6. HELPER
CREATE OR REPLACE FUNCTION public.get_roi_rule_threshold(p_rule_key text)
RETURNS numeric
LANGUAGE sql STABLE
AS $$
  SELECT threshold_numeric FROM public.roi_decision_rules WHERE rule_key = p_rule_key AND is_enabled = true LIMIT 1
$$;

-- 7. COMPUTE CURRICULUM UNIT ECONOMICS
CREATE OR REPLACE FUNCTION public.compute_curriculum_unit_economics(p_qualification_catalog_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prod_cost numeric := 0; v_campaign_cost numeric := 0; v_distribution_cost numeric := 0;
  v_optimization_cost numeric := 0; v_total_cost numeric := 0; v_revenue numeric := 0;
  v_margin numeric := 0; v_roi numeric := 0; v_payback_days numeric := NULL;
  v_ltv numeric := 0; v_cac numeric := 0; v_contribution numeric := 0;
  v_decision text := 'hold'; v_roi_min numeric; v_margin_min numeric;
BEGIN
  v_roi_min := coalesce(public.get_roi_rule_threshold('curriculum_roi_min'), 1.2);
  v_margin_min := coalesce(public.get_roi_rule_threshold('curriculum_margin_min'), 0.25);

  SELECT coalesce(sum(metric_value),0) INTO v_prod_cost FROM public.control_plane_cost_signals WHERE layer_key='production' AND metric_key='daily_estimated_cost';
  SELECT coalesce(sum(metric_value),0) INTO v_campaign_cost FROM public.control_plane_cost_signals WHERE layer_key='campaigns' AND metric_key='daily_estimated_cost';
  SELECT coalesce(sum(metric_value),0) INTO v_distribution_cost FROM public.control_plane_cost_signals WHERE layer_key='distribution' AND metric_key='daily_estimated_cost';
  SELECT coalesce(sum(metric_value),0) INTO v_optimization_cost FROM public.control_plane_cost_signals WHERE layer_key='optimization' AND metric_key='daily_estimated_cost';

  SELECT coalesce(sum(cps.revenue),0) INTO v_revenue
  FROM public.campaign_performance_snapshots cps
  JOIN public.campaign_assets ca ON ca.id = cps.asset_id
  WHERE ca.qualification_catalog_id = p_qualification_catalog_id;

  v_total_cost := v_prod_cost + v_campaign_cost + v_distribution_cost + v_optimization_cost;
  v_margin := greatest(0, v_revenue - v_total_cost);
  v_roi := CASE WHEN v_total_cost > 0 THEN v_revenue / v_total_cost ELSE 0 END;
  v_contribution := CASE WHEN v_revenue > 0 THEN v_margin / v_revenue ELSE 0 END;
  v_ltv := v_revenue * 1.8;
  v_cac := CASE WHEN v_revenue > 0 THEN v_total_cost / greatest(1, v_revenue / 50.0) ELSE v_total_cost END;
  v_payback_days := CASE WHEN v_margin > 0 THEN round(v_total_cost / greatest(1, v_margin) * 30, 1) ELSE NULL END;

  v_decision := CASE
    WHEN v_roi >= 1.5 AND v_contribution >= 0.35 THEN 'scale'
    WHEN v_roi >= v_roi_min AND v_contribution >= v_margin_min THEN 'promote'
    WHEN v_roi > 0.8 THEN 'hold'
    WHEN v_revenue > 0 THEN 'pause'
    ELSE 'hold'
  END;

  INSERT INTO public.curriculum_unit_economics (
    qualification_catalog_id, curriculum_id,
    production_cost_estimate, campaign_cost_estimate, distribution_cost_estimate, optimization_cost_estimate,
    total_cost_estimate, attributed_revenue, gross_margin, roi, payback_days,
    ltv_estimate, cac_estimate, contribution_margin, decision, reasoning, updated_at, last_computed_at
  ) VALUES (
    p_qualification_catalog_id, NULL,
    v_prod_cost, v_campaign_cost, v_distribution_cost, v_optimization_cost,
    v_total_cost, v_revenue, v_margin, v_roi, v_payback_days,
    v_ltv, v_cac, v_contribution, v_decision,
    jsonb_build_object('roi_min', v_roi_min, 'margin_min', v_margin_min),
    now(), now()
  )
  ON CONFLICT (qualification_catalog_id)
  DO UPDATE SET
    production_cost_estimate = excluded.production_cost_estimate,
    campaign_cost_estimate = excluded.campaign_cost_estimate,
    distribution_cost_estimate = excluded.distribution_cost_estimate,
    optimization_cost_estimate = excluded.optimization_cost_estimate,
    total_cost_estimate = excluded.total_cost_estimate,
    attributed_revenue = excluded.attributed_revenue,
    gross_margin = excluded.gross_margin,
    roi = excluded.roi,
    payback_days = excluded.payback_days,
    ltv_estimate = excluded.ltv_estimate,
    cac_estimate = excluded.cac_estimate,
    contribution_margin = excluded.contribution_margin,
    decision = excluded.decision,
    reasoning = excluded.reasoning,
    updated_at = now(),
    last_computed_at = now();

  RETURN jsonb_build_object('ok', true, 'qualification_catalog_id', p_qualification_catalog_id, 'roi', round(v_roi, 4), 'decision', v_decision);
END;
$$;

-- 8. COMPUTE CHANNEL UNIT ECONOMICS
CREATE OR REPLACE FUNCTION public.compute_channel_unit_economics(p_channel_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cost numeric := 0; v_revenue numeric := 0; v_impressions numeric := 0;
  v_clicks numeric := 0; v_leads numeric := 0; v_purchases numeric := 0;
  v_roi numeric := 0; v_ctr numeric := 0; v_lead_rate numeric := 0;
  v_conversion numeric := 0; v_rev_per_lead numeric := 0; v_rev_per_asset numeric := 0;
  v_decision text := 'hold'; v_rule numeric; v_asset_count numeric := 0;
BEGIN
  v_rule := coalesce(public.get_roi_rule_threshold('channel_roi_min'), 1.05);

  SELECT coalesce(sum(cps.revenue),0), coalesce(sum(cps.impressions),0), coalesce(sum(cps.clicks),0),
         coalesce(sum(cps.leads),0), coalesce(sum(cps.purchases),0), count(DISTINCT cps.asset_id)
  INTO v_revenue, v_impressions, v_clicks, v_leads, v_purchases, v_asset_count
  FROM public.campaign_performance_snapshots cps
  JOIN public.campaign_assets ca ON ca.id = cps.asset_id
  WHERE ca.channel = p_channel_key;

  SELECT coalesce(sum(metric_value),0) INTO v_cost
  FROM public.control_plane_cost_signals
  WHERE layer_key = CASE WHEN p_channel_key IN ('b2c','seo','affiliate','b2b','email','paid') THEN 'campaigns' ELSE 'distribution' END
    AND metric_key = 'daily_estimated_cost';

  v_roi := CASE WHEN v_cost > 0 THEN v_revenue / v_cost ELSE 0 END;
  v_ctr := CASE WHEN v_impressions > 0 THEN (v_clicks / v_impressions) * 100 ELSE 0 END;
  v_lead_rate := CASE WHEN v_clicks > 0 THEN (v_leads / v_clicks) * 100 ELSE 0 END;
  v_conversion := CASE WHEN v_clicks > 0 THEN (v_purchases / v_clicks) * 100 ELSE 0 END;
  v_rev_per_lead := CASE WHEN v_leads > 0 THEN v_revenue / v_leads ELSE 0 END;
  v_rev_per_asset := CASE WHEN v_asset_count > 0 THEN v_revenue / v_asset_count ELSE 0 END;

  v_decision := CASE
    WHEN v_roi >= 1.5 THEN 'scale'
    WHEN v_roi >= v_rule THEN 'keep_running'
    WHEN v_roi > 0.7 THEN 'hold'
    WHEN v_revenue > 0 THEN 'pause'
    ELSE 'hold'
  END;

  INSERT INTO public.channel_unit_economics (
    channel_key, attributed_cost, attributed_revenue, roi, ctr, lead_rate,
    conversion_rate, revenue_per_lead, revenue_per_asset, decision, reasoning,
    updated_at, last_computed_at
  ) VALUES (
    p_channel_key, v_cost, v_revenue, v_roi, v_ctr, v_lead_rate,
    v_conversion, v_rev_per_lead, v_rev_per_asset, v_decision,
    jsonb_build_object('roi_rule', v_rule), now(), now()
  )
  ON CONFLICT (channel_key)
  DO UPDATE SET
    attributed_cost = excluded.attributed_cost, attributed_revenue = excluded.attributed_revenue,
    roi = excluded.roi, ctr = excluded.ctr, lead_rate = excluded.lead_rate,
    conversion_rate = excluded.conversion_rate, revenue_per_lead = excluded.revenue_per_lead,
    revenue_per_asset = excluded.revenue_per_asset, decision = excluded.decision,
    reasoning = excluded.reasoning, updated_at = now(), last_computed_at = now();

  RETURN jsonb_build_object('ok', true, 'channel_key', p_channel_key, 'roi', round(v_roi, 4), 'decision', v_decision);
END;
$$;

COMMIT;
