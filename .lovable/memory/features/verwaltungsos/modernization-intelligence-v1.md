---
name: VerwaltungsOS Modernisierungs-Intelligence
description: Cut A4 — lightweight Process-Mining über alle aktiven verwaltung_agent_workflows. View v_verwaltung_modernization_opportunities + RPC verwaltung_modernization_opportunities + Cockpit-Card. Smoke 24/24 grün.
type: feature
---

# Modernisierungs-Intelligence — FROZEN 2026-05-28 (Cut A4)

## Scoring (deterministisch, 0–100, kein LLM)
- +30 Automation-Hint vorhanden (`jsonb_array_length > 0`)
- +20 Step-Count ≥ 5
- +20 keine `kpi_targets` (Outcome-Tracking fehlt)
- +15 `escalation_triggers` vorhanden
- +15 `governance_notes` < 40 Zeichen (Governance-Gap)

## Klassifikation
- ≥70 HIGH_OPPORTUNITY
- ≥40 MEDIUM_OPPORTUNITY
- >0  LOW_OPPORTUNITY
- =0  OK

## Artefakte
- View `v_verwaltung_modernization_opportunities` (service_role only)
- RPC `verwaltung_modernization_opportunities(_limit int)` — VOLATILE SECURITY DEFINER, admin OR service_role
- Audit-Contract `verwaltung_modernization_opportunities_read` (required_keys: limit, caller_role)
- Cockpit-Card in `/admin/verwaltung/cockpit` zwischen Workflow-Pressure und Cluster-Heat

## Anti-Drift
- Kein LLM — reine SQL-Heuristik, jede Punktevergabe nachvollziehbar.
- `fn_emit_audit` mit Named-Args — Audit pflicht pro Read.
- View nicht an `authenticated` graten — ausschließlich service_role.

## Smoke
`scripts/verwaltung-modernization-a4-smoke.mjs` — 24/24 GREEN.
