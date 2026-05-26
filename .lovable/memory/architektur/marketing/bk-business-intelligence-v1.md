---
name: BK-Business-Intelligence v1 (BK-Act-4)
description: SSOT manager_*-RPCs (deterministische Aggregate aus workflow_outcomes) + Ausbildungs-Cockpit-Page mit Heatmap, Risk-Radar, AI-Impact, Interventions, Quality-Score
type: feature
---

# BK-Business-Intelligence v1 — Ausbildungssteuerungssystem

**Status:** live (2026-05-26)

## Ziel
BerufsKI ist nicht mehr „AI-Tool", sondern **Ausbildungs-Cockpit**. Ausbildungsleiter sehen Risiken, Wirkung und konkrete Maßnahmen — alles deterministisch aus `workflow_outcomes` (BK-Act-3) + `org_memberships` + `user_competency_mastery`.

## Architektur-Prinzip
**Keine generativen KPIs.** Aggregation rein SQL, AI nur später für Narrative (Act-5). Quelle: nur SSOT-Tabellen.

## Gate (DRY)
`fn_manager_bi_gate(org_id, surface)` → `is_org_member_with_role(uid, org, ['owner','admin','manager'])`. Alle 5 RPCs rufen diesen Helper als Pflicht-Check.

## 5 Manager-RPCs (alle SECURITY DEFINER STABLE, GRANT authenticated)
| RPC | Liefert |
|---|---|
| `manager_get_team_readiness_heatmap(org,days)` | rows[user_id, overall_score/band, total_runs, cells[outcome_type→{avg_score, avg_confidence, runs, band}]], columns[6 outcome_types] |
| `manager_get_risk_radar(org,days)` | dimensions[5]: at_risk_competency, stagnant_learners, low_recovery, low_exam_confidence, inactive_14d (Wert + Total) |
| `manager_get_team_ai_impact(org,days)` | workflows_run, minutes_saved, hours_saved, analyses_automated, documents_assisted, communications_assisted, risk_signals_detected, active_learners |
| `manager_get_intervention_recommendations(org,days)` | recommendations[R1 critical_competency_cluster · R2 exam_risk_high · R3 oral_prep_gap · R4 inactive_learners], deterministische Schwellen, severity high/medium/low + action_target |
| `manager_get_training_quality_score(org,days)` | composite 0..100 = outcome·0.40 + confidence·100·0.20 + activity_share·0.25 + risk_share·0.15, breakdown[], band green/amber/red |

## Bands (single source)
green ≥75 · amber ≥55 · red <55 (Score 0..100). Risk-Dimension: ≥30% red, ≥15% amber.

## UI
**Page** `/berufs-ki/intelligence` (`BerufsKIIntelligencePage`):
- Org-Selector (nur Owner/Admin/Manager-Memberships), Days-Picker (7/30/90)
- 5 Cards: QualityScoreCard, AiImpactCard, RiskRadarCard, HeatmapCard, InterventionsCard
- Reines token-basiertes Styling (status-bg-subtle, status-text, status-border — DS v2 konform)
- Heatmap: Tabelle mit farbcodierten Score-Pillen pro outcome_type×user

## Audit
`manager_bi_query` registriert in `ops_audit_contract` (required_keys org_id, surface, window_days; owner berufs-ki/bi-layer). RPC-Side emit kommt in v1.1 (Phase 2 zusammen mit Tracking-Mirror).

## Was bewusst NICHT in v1 ist
- AI-Narrative pro Heatmap-Row (BK-Act-5)
- Multi-Standort-Vergleich + Ausbildungsjahr-Cohort-Filter (BK-Act-5)
- Mastery-Spalte (Tabelle existiert + RLS owner-only — bricht Aggregat ohne Bypass; Plan: dediziertes mastery_team_view via SECURITY DEFINER in Act-5)
- Realtime-Refresh (manuelles invalidate reicht; Polling 30s staleTime)
- Export PDF/CSV (Act-5 Enterprise-Layer)
- Recovery-Loop-Bridge (org_intervention_events Tabelle existiert, Bridge bleibt für Act-5)

## Plattform-Wiederverwendbarkeit
- `fn_manager_bi_gate` ist generisch: wiederverwendbar für ComplianceFit-, Voice-, Marketplace-BI-RPCs
- Heatmap-Pattern (rows × columns mit band-classifier) wiederverwendbar für jede org-scoped Outcome-Tabelle
