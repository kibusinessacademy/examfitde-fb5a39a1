---
name: BK-Act-5.2 Cross-Org Intelligence
description: Deterministic cross-org aggregates (readiness, site comparison, cohort trends, recovery, intervention impact, cluster risk, org quality) + Executive Cockpit
type: feature
---

# BK-Act-5.2 — Cross-Org Intelligence

Erweitert BK-Act-4 (Team-BI) und BK-Act-5.1 (Org-Struktur) zu organisationsweiter Workforce Intelligence. **Keine neuen Tabellen** — alle Aggregate deterministisch aus `workflow_outcomes` + `org_member_assignments` + Org-Struktur.

## Scope-Helper (SSOT)
`fn_org_visible_user_ids(_org_id, _user)` (service_role only) — server-seitige Auflösung der sichtbaren Lerner pro Caller:
- `has_full_org_scope` (owner/admin) → alle aktiven `org_memberships`
- sonst → User aus `org_member_assignments` matching scoped `site_ids` / `department_ids` / `cohort_ids` aus `fn_org_user_scope`

## 7 Manager-RPCs (alle SECURITY DEFINER STABLE, gated via `fn_manager_bi_gate`, audit-emit Pflicht)

| RPC | Liefert |
|---|---|
| `manager_get_cross_org_readiness` | sites[]/departments[]/cohorts[] mit learners, avg_score, runs, band |
| `manager_get_site_comparison` | rank-ordered Standorte: avg_score, activity_pct, avg_risk_reduction, runs, band |
| `manager_get_cohort_trends` | current vs previous window: avg_score, avg_score_prev, delta, trend (improvement/decline/stagnation), band |
| `manager_get_recovery_effectiveness` | total + by_site + by_cohort: avg_risk_reduction, avg_competency_impact, sample_size, band |
| `manager_get_intervention_impact` | pro `workflow_outcomes.recommended_next_action_key`: sample_size, avg_outcome_score, avg_confidence, avg_risk_reduction, band |
| `manager_get_competency_cluster_risk` | pro outcome_type: avg_score, low_share_pct (score<55), band |
| `manager_get_org_training_quality` | composite 0..100 (outcome·0.40 + confidence·0.20 + activity·0.25 + risk_visibility·0.15) + breakdown + insights{top_site, critical_cohort} |

## Bands (single source — wie BK-Act-4)
- Score: green ≥75 · amber ≥55 · red <55
- Recovery (Risk-Reduktion): green ≥25 · amber ≥10 · red <10
- Cluster-Risk (low_share): red ≥30% · amber ≥15% · green sonst
- Trend: ≥+3 improvement · ≤-3 decline · sonst stagnation

## Audit-Contracts
`cross_org_query`, `cohort_trend_query`, `recovery_effectiveness_query`, `intervention_impact_query`, `org_quality_query` (alle: org_id, surface, window_days). owner_module: `berufs-ki/cross-org-intel`.

## UI
**Route** `/berufs-ki/intelligence/executive` → `BerufsKIExecutiveIntelligencePage`
- Org-Selector (manager-Memberships) + Tageszeitraum 7/30/90
- Cards: OrgQuality (mit Top-Site/Critical-Cohort Insights), SiteComparison, RecoveryEffectiveness, CohortTrends, InterventionImpact, ClusterRisk, CrossOrgReadiness
- Reines token-basiertes Styling (DS v2)
- Link vom Team-Cockpit (BK-Act-4) zum Executive-Cockpit

## Was bewusst NICHT in v1 ist
- AI-Narrative pro Card (BK-Act-5.3 Executive Narrative)
- PDF/CSV-Export (BK-Act-5.4 Enterprise Reporting)
- Materialized Views — Aggregate skalieren noch in Echtzeit; Materialisierung erst bei N>10k Lernern/Org
- Ausbilder-Vergleich pro User (datenschutzrechtlich erst nach Privacy-Review)
- Real intervention_events Bridge (`org_intervention_events` existiert, aber Bridge erst nach Recovery-Loop-Vertiefung in BK-Act-5.3)

## Plattform-Wiederverwendbarkeit
- `fn_org_visible_user_ids` ist generisch reuse-fähig für jede org-scoped Query (ComplianceFit, Marketplace-BI, Voice-Agent-BI)
- Cohort-Trend-Pattern (cur vs prev window mit Delta + Trend-Label) wiederverwendbar für jedes Outcome-Aggregat

## Nächste Schritte
- BK-Act-5.3 — Executive Narrative (AI nur für Zusammenfassung deterministischer Aggregate)
- BK-Act-5.4 — Enterprise Reporting (PDF + Compliance Exports)
