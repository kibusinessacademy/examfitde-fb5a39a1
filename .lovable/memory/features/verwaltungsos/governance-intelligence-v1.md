---
name: VerwaltungsOS Governance Intelligence Layer
description: Cut A3 — /admin/verwaltung/governance mit AI-Audit-Trail (auto_heal_log), Refusal-Quality pro Department, Source-Coverage / Dead-Workflow-Detection über 128 Fachverfahren. Drei SECURITY DEFINER RPCs + 3 ops_audit_contract Einträge + Smoke 17/17 grün.
type: feature
---

# Governance Intelligence Layer — FROZEN 2026-05-28 (Cut A3)

## RPCs (alle VOLATILE, SECURITY DEFINER, admin ODER service_role)
- `verwaltung_governance_audit_trail(_window_days, _limit)` — direktes Lesen auf `auto_heal_log` (index-friendly: `created_at` zuerst), kategorisiert in `verwaltung_native | tutor_governance | refusal_event | general`. View `v_verwaltung_governance_audit` existiert nur als Doku/Service-Role-Sicht.
- `verwaltung_governance_refusal_quality(_window_days)` — leitet aus `verwaltung_oral_turns` Refusal-Rate + Qualified-Rate pro Department ab; Klassifikation `OK | OVER_REFUSING | LOW_QUALITY_REFUSALS | NO_REFUSALS | NO_DATA`.
- `verwaltung_governance_source_coverage(_window_days)` — Coverage über alle 128 `verwaltung_agent_workflows`; Klassifikation `COVERED | DEAD_WORKFLOW | NO_ACTIVITY | METADATA_GAP`.

## Audit-Contract
3 neue `ops_audit_contract`-Einträge (`*_read`, required_keys `[window_days, caller_role]`, owner_module `verwaltungsos.governance`). Jeder Lese-Call schreibt via `fn_emit_audit` named-args.

## UI
`/admin/verwaltung/governance` (`VerwaltungGovernancePage`) — drei Cards tokens-only (status-bg-*-subtle/-fg/-border), Audit-Tabelle, Refusal-Empty-State, Dead-Workflow-Grid + Coverage-Drilldown.

## Anti-Drift
- VOLATILE Pflicht (sonst INSERT in read-only transaction).
- `fn_emit_audit` IMMER mit Named-Args (`_action_type :=`, `_payload :=`) — Signatur hat 7 Args.
- View `v_verwaltung_governance_audit` ausschließlich service_role — niemals an authenticated graten.
- Audit-Trail-RPC darf nie über die View laufen, sondern direkt auf `auto_heal_log` mit `created_at`-Index-Prefilter (Timeout-Schutz).
- Keine LLM-Pfade in Phase A — Cut A4 = Modernisierungs-Intelligence, ebenfalls deterministisch.

## Smoke
`scripts/verwaltung-governance-a3-smoke.mjs` — 17/17 GREEN: anon blocked (3×), Payload-Shape (11×), Contracts (3×).
