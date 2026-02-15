
-- ================================================
-- Monetization Engine: Price Recommendation + Forecast + LTV + B2B
-- ================================================

-- 1) Price Recommendation View
CREATE OR REPLACE VIEW public.v_price_recommendation AS
SELECT
  ue.package_id,
  ue.certification_name,
  ue.revenue_30d,
  ue.llm_cost_30d,
  ue.net_profit_30d,
  ue.roi_ratio,
  ue.cost_per_question,
  ue.avg_quality_score,
  CASE
    WHEN ue.roi_ratio IS NULL OR ue.revenue_30d = 0 THEN 'NO_DATA'
    WHEN ue.roi_ratio < 3 THEN 'PRICE_INCREASE'
    WHEN ue.roi_ratio >= 3 AND ue.roi_ratio < 6 THEN 'OPTIMIZE_COST'
    WHEN ue.roi_ratio >= 6 AND ue.roi_ratio < 10 THEN 'KEEP'
    WHEN ue.roi_ratio >= 10 THEN 'UPSCALE_MARKETING'
    ELSE 'KEEP'
  END AS recommendation,
  CASE
    WHEN ue.cost_per_question IS NOT NULL AND ue.cost_per_question > 0.25 THEN 'ESCALATION_CHECK'
    WHEN ue.cost_per_question IS NOT NULL AND ue.cost_per_question > 0.15 THEN 'MODEL_REVIEW'
    WHEN ue.cost_per_question IS NOT NULL AND ue.cost_per_question <= 0.10 THEN 'OPTIMAL'
    ELSE 'OK'
  END AS cost_action,
  CASE
    WHEN ue.avg_quality_score IS NOT NULL AND ue.avg_quality_score < 65 THEN 'QUALITY_ALERT'
    WHEN ue.avg_quality_score IS NOT NULL AND ue.avg_quality_score >= 80 THEN 'QUALITY_EXCELLENT'
    ELSE 'QUALITY_OK'
  END AS quality_status
FROM public.v_unit_economics_package ue;

-- 2) Profit Forecast View
CREATE OR REPLACE VIEW public.v_profit_forecast AS
SELECT
  ue.package_id,
  ue.certification_name,
  ue.revenue_30d,
  ue.llm_cost_30d,
  ue.net_profit_30d,
  ue.net_profit_30d * 1 AS forecast_current,
  ue.net_profit_30d * 2 AS forecast_2x,
  ue.net_profit_30d * 5 AS forecast_5x,
  ue.net_profit_30d * 10 AS forecast_10x,
  CASE
    WHEN ue.revenue_30d > 0 AND ue.llm_cost_30d > 0
    THEN ceil(ue.llm_cost_30d / (ue.revenue_30d / GREATEST(1, (
      SELECT count(*) FROM public.revenue_events re 
      WHERE re.certification_id = ue.certification_id 
        AND re.event_type = 'purchase' 
        AND re.created_at >= now() - interval '30 days'
    ))))
    ELSE NULL
  END AS break_even_units,
  CASE
    WHEN ue.revenue_30d > 0 THEN round(((ue.revenue_30d - ue.llm_cost_30d) / ue.revenue_30d * 100)::numeric, 1)
    ELSE NULL
  END AS contribution_margin_pct
FROM public.v_unit_economics_package ue;

-- 3) LTV per User View
CREATE OR REPLACE VIEW public.v_ltv_user AS
SELECT
  re.user_id,
  count(*) FILTER (WHERE re.event_type = 'purchase') AS purchases,
  count(*) FILTER (WHERE re.event_type = 'renewal') AS renewals,
  count(*) FILTER (WHERE re.event_type = 'upsell') AS upsells,
  coalesce(sum(re.amount) FILTER (WHERE re.event_type IN ('purchase','renewal','upsell')), 0) AS total_revenue,
  coalesce(sum(re.amount) FILTER (WHERE re.event_type = 'refund'), 0) AS total_refunds,
  coalesce(sum(re.amount) FILTER (WHERE re.event_type IN ('purchase','renewal','upsell')), 0)
    - abs(coalesce(sum(re.amount) FILTER (WHERE re.event_type = 'refund'), 0)) AS net_ltv,
  min(re.created_at) AS first_purchase,
  max(re.created_at) AS last_activity,
  count(DISTINCT re.certification_id) AS unique_certifications
FROM public.revenue_events re
WHERE re.user_id IS NOT NULL
GROUP BY re.user_id;

-- 4) B2B Metrics View
CREATE OR REPLACE VIEW public.v_b2b_metrics AS
SELECT
  re.user_id AS buyer_id,
  count(DISTINCT re.certification_id) AS certifications_bought,
  coalesce(sum(re.amount) FILTER (WHERE re.event_type = 'purchase'), 0) AS total_spend,
  count(*) FILTER (WHERE re.event_type = 'purchase') AS total_orders,
  avg(re.amount) FILTER (WHERE re.event_type = 'purchase') AS avg_order_value,
  max(re.created_at) AS last_purchase,
  CASE
    WHEN count(*) FILTER (WHERE re.event_type = 'purchase') >= 3 THEN 'enterprise'
    WHEN coalesce(sum(re.amount) FILTER (WHERE re.event_type = 'purchase'), 0) >= 500 THEN 'business'
    ELSE 'individual'
  END AS customer_segment
FROM public.revenue_events re
WHERE re.user_id IS NOT NULL
GROUP BY re.user_id;
