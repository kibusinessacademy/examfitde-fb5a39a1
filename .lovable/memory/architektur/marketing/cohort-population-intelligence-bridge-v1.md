---
name: Cohort & Population Intelligence (Bridge 9)
description: SSOT für Gruppen-/Population-Analytik. Cohort Snapshots, Population Risk Clusters, Org Learning Health, Exam Benchmarks. Educational Intelligence über die Einzel-Lerner-Sicht hinaus.
type: feature
---

# Bridge 9 — Cohort & Population Intelligence

**Prinzip**: Vom adaptiven Einzel-Lerner (Bridge 4–8) zur Population-Sicht: welche Cohorten/Curricula/LFs/Organisationen sind kritisch, welche Interventionen wirken kollektiv, welche Benchmarks gelten als „Normal".

## SSOT-Tabellen
- **`cohort_snapshots`** (admin-read, service_role-write) — append/upsert pro `(cohort_type, cohort_key, snapshot_date)`. Cohort-Typen: organization | curriculum | lf_code | region | exam_window | custom. Metriken: avg_readiness, pct_at_risk, pct_ready, pass_rate, fail_rate, active/inactive learners.
- **`population_risk_clusters`** (admin-read, service_role-write) — UNIQUE per `cluster_key`. Aggregat aus `intervention_effectiveness_scores` mit risk_bucket + top_failure_drivers + top_effective_interventions + confidence (low/medium/high via Sample-Size).
- **`organization_learning_health`** (admin-read, service_role-write) — pro Org × Curriculum × snapshot_date (partial unique indexes für curriculum_id NULL/NOT NULL). Trägt intervention_effectiveness_avg_pp + quality_score.

## Views (service_role only)
- `v_cohort_readiness_distribution` — 90d Cohort-Snapshots
- `v_population_failure_patterns` — Cluster mit risk_bucket ∈ {HIGH, CRITICAL} OR fail_rate ≥ 30%
- `v_org_intervention_effectiveness` — 90d Org-Health
- `v_exam_readiness_benchmarks` — Aggregate Benchmarks pro Curriculum × snapshot_date

## Admin-RPCs (SECURITY DEFINER + has_role)
- `admin_get_cohort_readiness_distribution(p_limit)`
- `admin_get_population_failure_patterns(p_limit)`
- `admin_get_org_intervention_effectiveness(p_limit)`
- `admin_get_exam_readiness_benchmarks(p_limit)`

## Recompute
- `fn_recompute_population_intelligence()` SECURITY DEFINER (service_role):
  - **Cohort Snapshot Curriculum**: latest readiness_score/verdict pro user×curriculum aus `learner_readiness_history` → UPSERT in `cohort_snapshots` mit cohort_type='curriculum'.
  - **Risk Clusters**: Aggregat aus `intervention_effectiveness_scores` pro lf_code × risk_bucket → UPSERT in `population_risk_clusters` mit confidence-Label nach Sample-Size (≥50 high, ≥15 medium).
  - Audit in `auto_heal_log` (`action_type='population_intelligence_recompute'`, ok/error mit jsonb-Details).

## Cockpit
- `CohortPopulationIntelligenceCard` im Heal-Cockpit Diagnostics-Tab — drei Sektionen (Cohort Distribution, Failure Patterns, Benchmarks).

## Vorgemerkt (nicht in v1)
- Cron daily für `fn_recompute_population_intelligence`
- Org-Snapshot-Generator (joint learner_course_grants × organization_members × readiness_history)
- LF-Code-Cohort-Snapshot via `competency_results` Aggregation
- Trend-Mini-Sparks (7d delta) auf der Card
- Ausbildungsleiter-Dashboard mit Drilldown Org → Curriculum → Learner
