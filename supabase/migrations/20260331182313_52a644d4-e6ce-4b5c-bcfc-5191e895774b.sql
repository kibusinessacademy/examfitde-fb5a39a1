
DROP VIEW IF EXISTS public.v_audit_finding_trends CASCADE;

CREATE VIEW public.v_audit_finding_trends AS
WITH recent_runs AS (
  SELECT id, started_at, ROW_NUMBER() OVER (ORDER BY started_at DESC) AS run_rank
  FROM public.nightly_audit_runs WHERE status = 'completed'
  ORDER BY started_at DESC LIMIT 14
),
fh AS (
  SELECT f.finding_code, f.entity_type, f.entity_id, f.severity, f.finding_class,
    r.run_rank, r.started_at AS run_date, f.metric_value, f.healed
  FROM public.nightly_audit_findings f JOIN recent_runs r ON r.id = f.run_id
),
agg AS (
  SELECT finding_code, entity_type, entity_id,
    MAX(severity) AS max_severity, MAX(finding_class) AS finding_class,
    COUNT(*) AS occurrence_count,
    COUNT(*) FILTER (WHERE run_rank = 1) AS in_latest,
    COUNT(*) FILTER (WHERE run_rank <= 3) AS in_last_3,
    MIN(run_date) AS first_seen, MAX(run_date) AS last_seen,
    AVG(metric_value) FILTER (WHERE run_rank <= 3) AS recent_avg_metric,
    AVG(metric_value) FILTER (WHERE run_rank > 3) AS older_avg_metric,
    BOOL_OR(healed) AS was_ever_healed
  FROM fh GROUP BY finding_code, entity_type, entity_id
)
SELECT *,
  CASE
    WHEN in_latest > 0 AND occurrence_count >= 3 
      AND recent_avg_metric IS NOT NULL AND older_avg_metric IS NOT NULL 
      AND recent_avg_metric > older_avg_metric * 1.5 THEN 'escalating'
    WHEN in_latest > 0 AND occurrence_count >= 3 THEN 'persistent'
    WHEN in_latest > 0 AND occurrence_count < 3 THEN 'new'
    WHEN in_latest = 0 AND in_last_3 > 0 THEN 'healed'
    WHEN in_latest > 0 AND in_last_3 = 1
      AND occurrence_count > 3 THEN 'relapsed'
    ELSE 'resolved'
  END AS trend_status
FROM agg;
