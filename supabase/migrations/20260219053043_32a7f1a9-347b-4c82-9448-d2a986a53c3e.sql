
ALTER TABLE public.competency_performance_stats
  ADD COLUMN IF NOT EXISTS max_regen_reached boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_regen_at timestamptz;

CREATE OR REPLACE VIEW public.v_pruefungsreife_index AS
SELECT
  uap.user_id, uap.curriculum_id, c.title AS curriculum_name,
  COALESCE(uap.theta_overall, 0)::numeric AS theta,
  COALESCE(uap.pass_probability, 0)::numeric AS pass_probability,
  ROUND((
    COALESCE(uap.pass_probability, 0)::numeric * 0.5 +
    LEAST(GREATEST((COALESCE(uap.theta_overall, 0)::numeric + 3) / 6.0, 0), 1.0) * 0.3 +
    LEAST(COALESCE(uap.total_items_seen, 0)::numeric / 100.0, 1.0) * 0.2
  ) * 100, 1) AS pri_score,
  uap.total_items_seen, uap.updated_at
FROM public.user_ability_profiles uap
LEFT JOIN public.curricula c ON c.id = uap.curriculum_id;

CREATE OR REPLACE VIEW public.v_early_warning AS
SELECT
  uap.user_id, uap.curriculum_id, c.title AS curriculum_name,
  COALESCE(uap.pass_probability, 0)::numeric AS pass_probability,
  COALESCE(uap.theta_overall, 0)::numeric AS theta,
  COALESCE(uap.total_items_seen, 0) AS total_items_seen,
  ROUND(GREATEST(0::numeric, LEAST(100::numeric,
    (1 - COALESCE(uap.pass_probability, 0)::numeric) * 50 +
    CASE WHEN COALESCE(uap.theta_overall, 0) < -0.5 THEN 25 ELSE 0 END +
    CASE WHEN COALESCE(uap.total_items_seen, 0) < 20 THEN 15 ELSE 0 END +
    CASE WHEN uap.updated_at < now() - interval '7 days' THEN 10 ELSE 0 END
  )), 1) AS risk_score,
  CASE
    WHEN COALESCE(uap.pass_probability, 0) < 0.35 THEN 'critical'
    WHEN COALESCE(uap.pass_probability, 0) < 0.55 THEN 'at_risk'
    ELSE 'on_track'
  END AS risk_level,
  uap.updated_at AS last_activity_at
FROM public.user_ability_profiles uap
LEFT JOIN public.curricula c ON c.id = uap.curriculum_id
WHERE COALESCE(uap.pass_probability, 0) < 0.55
   OR COALESCE(uap.theta_overall, 0) < -0.5
   OR uap.updated_at < now() - interval '7 days';

CREATE OR REPLACE VIEW public.v_competency_heatmap AS
SELECT
  cps.curriculum_id, cps.competency_id,
  comp.title AS competency_name, lf.title AS learning_field_name,
  cps.fragility_level, cps.total_attempts, cps.trusted_attempts, cps.unique_learners,
  ROUND(cps.fail_rate::numeric * 100, 1) AS fail_rate_pct,
  ROUND(cps.repeat_fail_rate::numeric * 100, 1) AS repeat_fail_rate_pct,
  ROUND(cps.avg_score::numeric, 1) AS avg_score_pct,
  cps.regeneration_count, cps.frozen, cps.last_updated
FROM public.competency_performance_stats cps
LEFT JOIN public.competencies comp ON comp.id = cps.competency_id
LEFT JOIN public.learning_fields lf ON lf.id = cps.learning_field_id
ORDER BY cps.fail_rate DESC;

CREATE OR REPLACE VIEW public.v_cost_per_package AS
SELECT
  jc.package_id, cp.certification_id,
  cc.title AS certification_name,
  cp.status AS package_status,
  COUNT(DISTINCT jc.id) AS total_jobs,
  ROUND(SUM(jc.cost_eur)::numeric, 2) AS total_cost_eur,
  SUM(jc.tokens_input) AS total_tokens_in, SUM(jc.tokens_output) AS total_tokens_out,
  ROUND(AVG(jc.latency_ms)::numeric, 0) AS avg_latency_ms,
  MIN(jc.created_at) AS first_cost_at, MAX(jc.created_at) AS last_cost_at
FROM public.job_costs jc
LEFT JOIN public.course_packages cp ON cp.id = jc.package_id
LEFT JOIN public.certification_catalog cc ON cc.id = cp.certification_id
WHERE jc.package_id IS NOT NULL
GROUP BY jc.package_id, cp.certification_id, cc.title, cp.status;
