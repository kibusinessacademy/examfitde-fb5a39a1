
-- Unit Economics Views (fix: revenue_events uses 'amount' not 'amount_eur')

-- v_unit_economics_package: profit per package
CREATE OR REPLACE VIEW public.v_unit_economics_package AS
SELECT
  cp.id AS package_id,
  cp.certification_id,
  cp.curriculum_id,
  cc.title AS certification_name,
  coalesce(rev.revenue_30d, 0) AS revenue_30d,
  coalesce(rev.refunds_30d, 0) AS refunds_30d,
  coalesce(cost.llm_cost_30d, 0) AS llm_cost_30d,
  coalesce(cost.llm_cost_total, 0) AS llm_cost_total,
  coalesce(rev.revenue_30d, 0) - coalesce(rev.refunds_30d, 0) - coalesce(cost.llm_cost_30d, 0) AS net_profit_30d,
  CASE WHEN coalesce(eq_count.q_count, 0) > 0
    THEN coalesce(cost.exam_pool_cost, 0) / eq_count.q_count
    ELSE NULL
  END AS cost_per_question,
  coalesce(eq_count.q_count, 0) AS question_count,
  pqs.quality_score AS avg_quality_score,
  CASE WHEN coalesce(cost.llm_cost_total, 0) > 0
    THEN (coalesce(rev.revenue_total, 0) - coalesce(rev.refunds_total, 0)) / cost.llm_cost_total
    ELSE NULL
  END AS roi_ratio
FROM public.course_packages cp
LEFT JOIN public.certification_catalog cc ON cc.id = cp.certification_id
LEFT JOIN public.package_quality_summary pqs ON pqs.package_id = cp.id
LEFT JOIN LATERAL (
  SELECT
    sum(amount) FILTER (WHERE event_type = 'purchase' AND created_at > now() - interval '30 days') AS revenue_30d,
    sum(amount) FILTER (WHERE event_type = 'refund' AND created_at > now() - interval '30 days') AS refunds_30d,
    sum(amount) FILTER (WHERE event_type = 'purchase') AS revenue_total,
    sum(amount) FILTER (WHERE event_type = 'refund') AS refunds_total
  FROM public.revenue_events re
  WHERE re.certification_id = cp.certification_id
) rev ON true
LEFT JOIN LATERAL (
  SELECT
    sum(cost_eur) FILTER (WHERE ts > now() - interval '30 days') AS llm_cost_30d,
    sum(cost_eur) AS llm_cost_total,
    sum(cost_eur) FILTER (WHERE job_type = 'package_generate_exam_pool') AS exam_pool_cost
  FROM public.llm_cost_events lce
  WHERE lce.package_id = cp.id
) cost ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS q_count
  FROM public.exam_questions eq
  WHERE eq.curriculum_id = cp.curriculum_id
) eq_count ON true
WHERE cp.status IS DISTINCT FROM 'archived';

-- v_cost_per_question
CREATE OR REPLACE VIEW public.v_cost_per_question AS
SELECT
  lce.package_id,
  cp.certification_id,
  cc.title AS certification_name,
  sum(lce.cost_eur) AS exam_pool_cost_eur,
  count(DISTINCT eq.id) AS question_count,
  CASE WHEN count(DISTINCT eq.id) > 0
    THEN sum(lce.cost_eur) / count(DISTINCT eq.id)
    ELSE NULL
  END AS cost_per_question
FROM public.llm_cost_events lce
JOIN public.course_packages cp ON cp.id = lce.package_id
LEFT JOIN public.certification_catalog cc ON cc.id = cp.certification_id
LEFT JOIN public.exam_questions eq ON eq.curriculum_id = cp.curriculum_id
WHERE lce.job_type = 'package_generate_exam_pool'
GROUP BY lce.package_id, cp.certification_id, cc.title;

-- v_escalation_rate
CREATE OR REPLACE VIEW public.v_escalation_rate AS
SELECT
  date_trunc('day', ts) AS day,
  count(*) AS total_calls,
  count(*) FILTER (WHERE model ILIKE '%sonnet%' OR model ILIKE '%gpt-4%' OR model ILIKE '%gpt-5%') AS escalated_calls,
  CASE WHEN count(*) > 0
    THEN round((count(*) FILTER (WHERE model ILIKE '%sonnet%' OR model ILIKE '%gpt-4%' OR model ILIKE '%gpt-5%'))::numeric / count(*) * 100, 1)
    ELSE 0
  END AS escalation_pct
FROM public.llm_cost_events
WHERE ts > now() - interval '30 days'
GROUP BY 1
ORDER BY 1 DESC;

-- v_revenue_cost_ratio
CREATE OR REPLACE VIEW public.v_revenue_cost_ratio AS
SELECT
  cc.id AS certification_id,
  cc.title AS certification_name,
  coalesce(sum(re.amount) FILTER (WHERE re.event_type = 'purchase'), 0) AS revenue_total,
  coalesce(sum(re.amount) FILTER (WHERE re.event_type = 'refund'), 0) AS refunds_total,
  coalesce(lce_agg.llm_cost, 0) AS llm_cost_total,
  CASE WHEN coalesce(lce_agg.llm_cost, 0) > 0
    THEN round(((coalesce(sum(re.amount) FILTER (WHERE re.event_type = 'purchase'), 0) 
                - coalesce(sum(re.amount) FILTER (WHERE re.event_type = 'refund'), 0)) 
                / lce_agg.llm_cost)::numeric, 1)
    ELSE NULL
  END AS revenue_cost_ratio
FROM public.certification_catalog cc
LEFT JOIN public.revenue_events re ON re.certification_id = cc.id
LEFT JOIN LATERAL (
  SELECT sum(lce.cost_eur) AS llm_cost
  FROM public.llm_cost_events lce
  JOIN public.course_packages cp ON cp.id = lce.package_id
  WHERE cp.certification_id = cc.id
) lce_agg ON true
GROUP BY cc.id, cc.title, lce_agg.llm_cost
ORDER BY revenue_cost_ratio DESC NULLS LAST;
