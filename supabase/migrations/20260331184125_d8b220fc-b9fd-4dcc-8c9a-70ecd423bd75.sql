
-- ═══════════════════════════════════════════════════════════════
-- P0 FIX: Harden v_audit_finding_trends + v_audit_incidents
-- - Replace MAX(severity) with numeric ranking
-- - Replace MAX(finding_class) with boolean flags
-- - Use BOOL_OR for incident classification
-- - Add any_healed + all_healed
-- - Allow single critical root_cause as incident
-- ═══════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.v_audit_incidents CASCADE;
DROP VIEW IF EXISTS public.v_audit_finding_trends CASCADE;

-- ── v_audit_finding_trends (hardened) ──
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
    -- Numeric severity ranking instead of MAX(text)
    MAX(CASE severity
      WHEN 'critical' THEN 3
      WHEN 'warning' THEN 2
      WHEN 'info' THEN 1
      ELSE 0
    END) AS severity_rank,
    -- Boolean flags for finding_class instead of MAX(text)
    BOOL_OR(finding_class = 'root_cause') AS has_root_cause,
    BOOL_OR(finding_class = 'symptom') AS has_symptom,
    BOOL_OR(finding_class = 'consequence') AS has_consequence,
    COUNT(*) AS occurrence_count,
    COUNT(*) FILTER (WHERE run_rank = 1) AS in_latest,
    COUNT(*) FILTER (WHERE run_rank <= 3) AS in_last_3,
    MIN(run_date) AS first_seen, MAX(run_date) AS last_seen,
    AVG(metric_value) FILTER (WHERE run_rank <= 3) AS recent_avg_metric,
    AVG(metric_value) FILTER (WHERE run_rank > 3) AS older_avg_metric,
    BOOL_OR(healed) AS any_healed,
    BOOL_AND(healed) AS all_healed
  FROM fh GROUP BY finding_code, entity_type, entity_id
)
SELECT *,
  CASE severity_rank
    WHEN 3 THEN 'critical'
    WHEN 2 THEN 'warning'
    WHEN 1 THEN 'info'
    ELSE 'unknown'
  END AS max_severity,
  CASE
    WHEN has_root_cause AND has_symptom THEN 'root_cause+symptom'
    WHEN has_root_cause THEN 'root_cause'
    WHEN has_symptom THEN 'symptom'
    WHEN has_consequence THEN 'consequence'
    ELSE 'unknown'
  END AS primary_finding_class,
  CASE
    WHEN in_latest > 0 AND occurrence_count >= 3 
      AND recent_avg_metric IS NOT NULL AND older_avg_metric IS NOT NULL 
      AND recent_avg_metric > older_avg_metric * 1.5 THEN 'escalating'
    WHEN in_latest > 0 AND occurrence_count >= 3 THEN 'persistent'
    WHEN in_latest > 0 AND occurrence_count < 3 THEN 'new'
    WHEN in_latest = 0 AND in_last_3 > 0 AND any_healed THEN 'healed'
    WHEN in_latest > 0 AND in_last_3 = 1
      AND occurrence_count > 3 THEN 'relapsed'
    WHEN in_latest = 0 THEN 'resolved'
    ELSE 'new'
  END AS trend_status
FROM agg;

-- ── v_audit_incidents (hardened) ──
CREATE VIEW public.v_audit_incidents AS
WITH entity_findings AS (
  SELECT
    f.entity_type,
    f.entity_id,
    f.run_id,
    f.finding_code,
    f.severity,
    f.finding_class,
    f.healed,
    f.metric_value,
    -- Severity rank for proper aggregation
    CASE f.severity
      WHEN 'critical' THEN 3
      WHEN 'warning' THEN 2
      WHEN 'info' THEN 1
      ELSE 0
    END AS severity_rank,
    -- Finding class rank
    CASE f.finding_class
      WHEN 'root_cause' THEN 3
      WHEN 'symptom' THEN 2
      WHEN 'consequence' THEN 1
      ELSE 0
    END AS class_rank
  FROM public.nightly_audit_findings f
  JOIN public.nightly_audit_runs r ON r.id = f.run_id
  WHERE r.status = 'completed'
    AND f.entity_id IS NOT NULL
    AND f.severity != 'info'
    -- Only from latest run
    AND r.id = (SELECT id FROM public.nightly_audit_runs WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1)
),
grouped AS (
  SELECT
    entity_type,
    entity_id,
    run_id,
    COUNT(*) AS evidence_count,
    MAX(severity_rank) AS max_severity_rank,
    MAX(class_rank) AS max_class_rank,
    -- Boolean signal flags for incident classification
    BOOL_OR(finding_code = 'hollow_completions') AS has_hollow_completions,
    BOOL_OR(finding_code = 'done_below_threshold') AS has_done_below_threshold,
    BOOL_OR(finding_code = 'false_success') AS has_false_success,
    BOOL_OR(finding_code = 'shadow_zombies') AS has_shadow_zombies,
    BOOL_OR(finding_code = 'integrity_mismatch') AS has_integrity_mismatch,
    BOOL_OR(finding_code = 'stale_building_24h') AS has_stale_building,
    BOOL_OR(finding_code LIKE 'heal_loop_%') AS has_heal_loop,
    BOOL_OR(finding_code = 'publish_stuck') AS has_publish_stuck,
    BOOL_OR(finding_code = 'processing_unlocked') AS has_processing_unlocked,
    array_agg(DISTINCT finding_code) AS finding_codes,
    BOOL_OR(healed) AS any_healed,
    BOOL_AND(healed) AS all_healed,
    SUM(metric_value) AS total_metric_value
  FROM entity_findings
  GROUP BY entity_type, entity_id, run_id
  -- Allow multi-signal OR single critical root_cause
  HAVING COUNT(*) >= 2
     OR (MAX(severity_rank) >= 3 AND MAX(class_rank) >= 3)
)
SELECT
  entity_type,
  entity_id,
  run_id,
  evidence_count,
  CASE max_severity_rank
    WHEN 3 THEN 'critical'
    WHEN 2 THEN 'warning'
    ELSE 'info'
  END AS max_severity,
  CASE max_class_rank
    WHEN 3 THEN 'root_cause'
    WHEN 2 THEN 'symptom'
    WHEN 1 THEN 'consequence'
    ELSE 'unknown'
  END AS max_finding_class,
  -- Derived incident type
  CASE
    WHEN has_hollow_completions OR has_done_below_threshold OR has_false_success
      THEN 'package_false_success_risk'
    WHEN has_shadow_zombies
      THEN 'package_shadow_zombie'
    WHEN has_integrity_mismatch
      THEN 'package_integrity_desync'
    WHEN has_stale_building
      THEN 'package_build_stall'
    WHEN has_heal_loop
      THEN 'package_heal_churn'
    WHEN has_publish_stuck
      THEN 'package_publish_blocked'
    WHEN has_processing_unlocked
      THEN 'job_corruption_risk'
    ELSE 'generic_incident'
  END AS incident_type,
  finding_codes,
  any_healed,
  all_healed,
  total_metric_value
FROM grouped;
