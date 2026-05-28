---
name: VerwaltungsOS Operations Outcome Loop
description: Cut A5 — Modernization-Snapshots + Outcome-Delta-RPC + Cockpit-Card. Beantwortet "wirkt die Modernisierungs-Empfehlung?" deterministisch (Δ ≥ 5). Smoke 24/24 grün.
type: feature
---

# Operations Outcome Loop — FROZEN 2026-05-28 (Cut A5)

## SSOT
- Tabelle `verwaltung_modernization_snapshots` UNIQUE(workflow_id, snapshot_date)
- Felder pro Tag/Workflow: opportunity_score, classification, oral_activity_30d (dept-proxy), refusal_rate_30d (dept-proxy)

## RPCs (admin/service_role)
- `verwaltung_capture_modernization_snapshot()` — idempotent per UTC-Tag, Audit `verwaltung_modernization_snapshot_captured`.
- `verwaltung_workflow_outcome_loop(_lookback_days, _limit)` — vergleicht latest vs. baseline (≥ lookback Tage); klassifiziert IMPROVED (Δ≤-5) / REGRESSED (Δ≥+5) / STABLE / NO_BASELINE. Audit `verwaltung_workflow_outcome_loop_read`.

## UI
- `/admin/verwaltung/cockpit` → neue Card nach Modernisierungs-Intelligence
- 4 Tiles (↓ ↑ = ø) + "Snapshot erfassen" Button (admin) + Top-Mover-Liste

## Anti-Drift
- Kein LLM — reine SQL-Heuristik.
- Audit-Calls mit Named-Args (`_payload`, nicht `_action_data`) — fn_emit_audit-Signatur.
- Snapshot-Tabelle nur Admin-SELECT + service_role-write.

## Smoke
`scripts/verwaltung-outcome-loop-a5-smoke.mjs` — 24/24 GREEN (128 Workflows captured, idempotent rerun, anon blocked).
