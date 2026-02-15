
-- Drop old views first (column names changed)
DROP VIEW IF EXISTS public.cost_quality_heatmap;
DROP VIEW IF EXISTS public.cost_intelligence;

-- Recreate cost_intelligence from llm_cost_events
CREATE VIEW public.cost_intelligence AS
SELECT
  job_type,
  model,
  provider,
  count(*) AS call_count,
  sum(cost_eur) AS total_cost_eur,
  avg(cost_eur) AS avg_cost_eur,
  sum(tokens_in + tokens_out) AS total_tokens,
  avg(tokens_in + tokens_out) AS avg_tokens_per_call,
  sum(cost_eur) FILTER (WHERE ts > now() - interval '1 day') AS cost_today_eur,
  sum(cost_eur) FILTER (WHERE ts > now() - interval '7 days') AS cost_7d_eur
FROM public.llm_cost_events
WHERE ts > now() - interval '30 days'
GROUP BY job_type, model, provider
ORDER BY total_cost_eur DESC;

-- Recreate cost_quality_heatmap
CREATE VIEW public.cost_quality_heatmap AS
SELECT
  ce.job_type,
  ce.model,
  ce.provider,
  count(*) AS call_count,
  sum(ce.cost_eur) AS total_cost_eur,
  avg(ce.cost_eur) AS avg_cost_eur,
  avg(pqs.quality_score) AS avg_quality_score,
  CASE
    WHEN avg(ce.cost_eur) <= 0.05 AND coalesce(avg(pqs.quality_score), 50) >= 75 THEN 'optimal'
    WHEN avg(ce.cost_eur) > 0.05 AND coalesce(avg(pqs.quality_score), 50) >= 75 THEN 'premium'
    WHEN avg(ce.cost_eur) <= 0.05 AND coalesce(avg(pqs.quality_score), 50) < 75 THEN 'bulk_acceptable'
    ELSE 'expensive_low_quality'
  END AS quadrant
FROM public.llm_cost_events ce
LEFT JOIN public.package_quality_summary pqs ON ce.package_id = pqs.package_id
WHERE ce.ts > now() - interval '30 days'
GROUP BY ce.job_type, ce.model, ce.provider
ORDER BY total_cost_eur DESC;
