
-- ═══ Quality Drift Monitor View ═══
-- Tracks quality score trend per model over time (7-day windows)
CREATE OR REPLACE VIEW public.quality_drift_monitor AS
SELECT
  m.model,
  date_trunc('day', g.created_at)::date AS day,
  count(*) AS question_count,
  round(avg(v.overall_score)::numeric, 1) AS avg_quality_score,
  round(stddev(v.overall_score)::numeric, 1) AS score_stddev,
  count(*) FILTER (WHERE v.decision = 'escalated' OR v.overall_score < 70) AS escalation_count,
  round((count(*) FILTER (WHERE v.decision = 'escalated' OR v.overall_score < 70))::numeric / NULLIF(count(*), 0) * 100, 1) AS escalation_rate_pct
FROM public.ai_generations g
LEFT JOIN public.ai_validations v ON v.generation_id = g.id
CROSS JOIN LATERAL (SELECT g.generator_model AS model) m
WHERE g.created_at >= now() - interval '30 days'
  AND g.entity_type IN ('exam_question', 'oral_question', 'minicheck')
GROUP BY m.model, date_trunc('day', g.created_at)::date
ORDER BY day DESC, m.model;

-- ═══ Cost vs Quality Heatmap View ═══
-- Correlates cost and quality per job_type + model for strategic decisions
CREATE OR REPLACE VIEW public.cost_quality_heatmap AS
SELECT
  u.job_type,
  u.model,
  count(*) AS call_count,
  round(avg(u.cost_eur)::numeric, 4) AS avg_cost_eur,
  round(sum(u.cost_eur)::numeric, 2) AS total_cost_eur,
  round(avg(v.overall_score)::numeric, 1) AS avg_quality_score,
  CASE
    WHEN avg(u.cost_eur) > 0.05 AND COALESCE(avg(v.overall_score), 0) < 70 THEN 'expensive_low_quality'
    WHEN avg(u.cost_eur) <= 0.05 AND COALESCE(avg(v.overall_score), 0) >= 80 THEN 'optimal'
    WHEN avg(u.cost_eur) > 0.05 AND COALESCE(avg(v.overall_score), 0) >= 80 THEN 'premium'
    ELSE 'bulk_acceptable'
  END AS quadrant
FROM public.ai_usage_log u
LEFT JOIN public.ai_generations g ON g.generator_model = u.model
  AND g.created_at BETWEEN u.created_at - interval '1 minute' AND u.created_at + interval '1 minute'
LEFT JOIN public.ai_validations v ON v.generation_id = g.id
WHERE u.created_at >= now() - interval '30 days'
GROUP BY u.job_type, u.model
HAVING count(*) >= 3
ORDER BY total_cost_eur DESC;

-- ═══ Error Spike Detection Enhancement ═══
-- Add first_seen + message fingerprint to error_observatory
CREATE OR REPLACE VIEW public.error_observatory AS
SELECT
  CASE
    WHEN jq.last_error ILIKE '%rate%limit%' THEN 'RATE_LIMIT'
    WHEN jq.last_error ILIKE '%timeout%' OR jq.last_error ILIKE '%timed out%' THEN 'TIMEOUT'
    WHEN jq.last_error ILIKE '%valid%' OR jq.last_error ILIKE '%schema%' OR jq.last_error ILIKE '%JSON%' THEN 'VALIDATION_FAIL'
    WHEN jq.last_error ILIKE '%prereq%' OR jq.last_error ILIKE '%prerequisite%' THEN 'PREREQ_NOT_DONE'
    WHEN jq.last_error ILIKE '%budget%' OR jq.last_error ILIKE '%cost%' THEN 'BUDGET_EXCEEDED'
    WHEN jq.last_error ILIKE '%duplic%' THEN 'DUPLICATE'
    ELSE 'OTHER'
  END AS error_cluster,
  jq.job_type,
  left(md5(regexp_replace(jq.last_error, '[0-9a-f-]{36}', 'ID', 'g')), 8) AS error_fingerprint,
  count(*) AS occurrence_count,
  count(*) FILTER (WHERE jq.updated_at > now() - interval '1 hour') AS last_1h,
  count(*) FILTER (WHERE jq.updated_at > now() - interval '24 hours') AS last_24h,
  min(jq.created_at) AS first_seen,
  max(jq.updated_at) AS last_seen,
  CASE WHEN count(*) FILTER (WHERE jq.updated_at > now() - interval '10 minutes') > 5 THEN true ELSE false END AS is_spike,
  jq.last_error AS sample_error
FROM public.job_queue jq
WHERE jq.status = 'failed' AND jq.last_error IS NOT NULL
GROUP BY error_cluster, jq.job_type, error_fingerprint, jq.last_error
ORDER BY occurrence_count DESC;
