---
name: BerufsKI Activation Layer v1
description: Manager Copilot + Automation + Executive Narrative + Product Suites — vertikaler Activation-Cut auf bestehende manager_* RPCs, keine neuen Foundation-Systeme.
type: feature
---

# BerufsKI Activation Layer v1 (BK-Act-6)

**Cut nach Graph Activation:** Adoption-Layer statt weiterer Architektur. Wiederverwendung der existierenden `manager_*` und `berufs_ki_*` RPCs.

## RPCs (alle SECURITY DEFINER, search_path=public, manager-gated via `fn_is_org_manager`)

- `manager_copilot_get_brief(_org_id, _days)` — Tagesbriefing. Synthese aus `manager_get_risk_radar` + `manager_get_cohort_trends` + `manager_get_intervention_impact` + `manager_get_recovery_effectiveness` + `manager_get_graph_risk_explanations`. Liefert priorisierte Liste (kind: inactivity/at_risk_competency/cohort_decline/graph_risk) + Snapshot.
- `automation_list_rules / automation_upsert_rule / automation_evaluate_org` — 5 Rule-Keys (`risk_radar_alert`, `cohort_stagnation`, `recovery_low_impact`, `inactivity_14d`, `exam_readiness_drop`). Deterministische Auswertung, jeder Run wird in `berufs_ki_automation_runs` geloggt.
- `executive_get_narrative(_org_id, _days)` — Deterministische Briefing-Bullets aus `manager_get_org_training_quality` + `manager_get_cohort_trends` + `manager_get_intervention_impact`. Kein AI-Aufruf — synthetisiertes Format.

## Tabellen
- `berufs_ki_automation_rules` (org_id, rule_key UNIQUE per org, enabled, params, notify_channel)
- `berufs_ki_automation_runs` (rule_id, matched_count, sample jsonb)
- `berufs_ki_product_suites` (slug, name, audience, tagline, description, route, modules) — SSOT für Packaging-Layer, 4 seeded Suites.

## RLS
- Rules/Runs: SELECT+ALL nur via `fn_is_org_manager(_org_id)` (owner/admin/manager).
- Suites: öffentlicher SELECT (Marketing), Write nur Plattform-Admin.

## Audit-Contracts (`ops_audit_contract`, owner_module=`berufs_ki_*`)
- `manager_copilot_brief_query` · `automation_rule_upsert` · `automation_org_evaluation` · `executive_narrative_query`

## Frontend SSOT
- `src/lib/berufs-ki/copilot.ts` · `automation.ts` · `suites.ts`
- `src/hooks/useBerufsKIActivation.ts` (Copilot, Narrative, Automation, Suites)
- Pages:
  - `/berufs-ki/copilot` — BerufsKICopilotPage (Tagesbriefing + Eval-Quickrun)
  - `/berufs-ki/automation` — BerufsKIAutomationPage (Toggle + Threshold + Run)
  - `/berufs-ki/suites` — BerufsKISuitesPage (Packaging-Layer öffentlich)
- Executive-Page: neue `ExecutiveNarrativeCard` oben.
- Hub: CTAs auf Suites + Copilot.

## Anti-Goals (eingehalten)
- Keine neuen Graph-Layer, keine neuen Outcome-/Recovery-Systeme, keine AI-Generierung im Kernpfad.
- Keine Parallel-Aggregationen: alle Werte fließen durch existierende `manager_*` RPCs.
- Manager-Gate hart via `fn_is_org_manager` (auth.uid → org_memberships → role).

## Baseline 2026-05-26
- 0 Automation-Rules konfiguriert (Owner aktivieren manuell).
- 4 Product-Suites seeded und live.
- Copilot/Narrative liefern echte Daten sobald BI-Layer populated ist.
