---
name: AI Runtime Command Center v1
description: /admin/runtime bündelt AI-Eval, Policy-Governance, Adaptive Sequencing, Observability & Intervention-Loop als read-only Control-Plane (Cards reused).
type: feature
---

# AI Runtime Command Center v1

## Route
- `/admin/runtime` → `src/pages/admin/v2/RuntimeCommandCenterPage.tsx`
- Navigation: zwischen `Heal Hub` und `Growth` als Top-Nav-Eintrag `AI Runtime` (Icon `Cpu`).

## Tabs
1. **Health** — `AiEvalRunsCard` (letzte 20 Runs, Status, Regression-Flags)
2. **Governance** — `PolicyGovernanceCard` (Mutationen, capped, max Δ)
3. **Sequencing** — `AdaptiveSequencingDecisionsCard` (Top-Regeln 7d + Regression-Alerts)
4. **Observability** — Platzhalter (Wire-in `admin_get_ai_observability_summary`)
5. **Intervention** — Platzhalter (Wire-in `v_recommendation_policy_effectiveness`)

## Scope
- Read-only. Keine Mutationen aus der UI.
- Safe-Actions (Re-run Eval, Rollback Policy, Disable Policy, Recompute Sequence) folgen im nächsten Cut mit Reason-Pflichtfeld + `auto_heal_log` Audit (`mem://constraints/admin-ui-leitstelle-v1`).

## Nicht-Ziele
- Kein Auto-Trigger des `ai-eval-worker` aus der UI (Cron `ai-eval-worker-6h` bleibt SSOT).
- Kein direkter Schreibzugriff auf `policy_versions` — nur via `fn_apply_policy_mutation_bounded` / `fn_rollback_policy_version` (service_role).

## Rollback
- Route + Nav-Eintrag entfernen, Page-Datei löschen. Keine DB-Änderungen.
