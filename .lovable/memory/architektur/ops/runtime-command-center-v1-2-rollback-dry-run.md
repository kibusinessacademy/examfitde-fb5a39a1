---
name: Runtime Command Center v1.2 Rollback + Dry-Run
description: runtime_action_reversible_policies SSOT + fn/admin_runtime_action_simulate (no-mutation dry-run) + admin_runtime_action_rollback (reversible window + parent chain) + Rollback button im Evidence-Drawer + DryRunCard + ReversiblePoliciesCard im /admin/runtime "Rollback & Dry-Run" Tab.
type: feature
---

# Runtime Command Center v1.2 — Rollback Runner + Dry-Run Simulation (2026-05-21)

Baut auf v1.1 Observability auf. Macht reversible Actions tatsächlich rollbackbar und führt deterministische no-mutation Dry-Runs ein.

## Schema
- `runtime_action_reversible_policies(action_key PK→runtime_safe_actions, is_reversible, max_age_minutes 1..10080, rollback_handler_key, requires_admin_confirm, notes)` — RLS admin read.
- `runtime_action_results +parent_action_id (FK self), +is_rollback, +simulation_only`. Partial index on parent_action_id.

## Reversible Matrix (seeded)
| action_key | reversible | window | inverse handler |
|---|---|---|---|
| freeze_policy | ✓ | 24h | policy.unfreeze (DELETE policy_freeze_state) |
| silence_alert | ✓ | 4h | observability.unsilence (DELETE alert_silences) |
| disable_dataset | ✓ | 24h | eval.enable_dataset (is_enabled=true) |
| rollback_policy | ✗ | — | meta: rollback-of-rollback verboten |
| recompute_sequence | ✗ | — | idempotent, kein Inverse nötig |
| re_run_eval_window / trigger_intervention_recheck / open_evidence_chain | ✗ | — | read-mostly |

## RPCs
- `fn_runtime_action_simulate(_action_key, _payload, _target_type, _target_id) → jsonb` (service_role only): per-handler predicted_before/after + blast_radius + risk_score (5/20/50/80 base + dangerous +10 + nicht-reversibel +10, cap 100) + warnings[]. **NIE Mutation**.
- `admin_runtime_action_simulate(...)`: has_role-Gate + Audit `runtime_safe_action_simulated`.
- `admin_runtime_action_rollback(_result_id, _reason)`:
  - reason ≥8 chars
  - status=completed AND NOT is_rollback
  - is_reversible=true AND age ≤ max_age_minutes
  - keine bestehende Rollback-Row (parent_action_id eindeutig)
  - dispatch inverse handler, INSERT neue runtime_action_results(action_key='rollback:'||orig, is_rollback=true, parent_action_id=orig.id), UPDATE orig.status='rolled_back'
  - Audit `runtime_safe_action_rolled_back`
- `admin_get_runtime_reversible_policies() → SETOF` (has_role-Gate).

## Audit-Contracts (ops_audit_contract)
- runtime_safe_action_simulated   · required: action_key, risk_score, reversible
- runtime_safe_action_rolled_back · required: original_action, rollback_id, age_minutes

## UI (/admin/runtime)
Neuer Tab **Rollback & Dry-Run**:
- `RuntimeDryRunCard` — Action-Picker (nur enabled) + JSON-Payload + Simulate-Button → Diff-Inspector (reuse runtimeDiff), Blast-Radius JSON, Risk-Badge, Warnings.
- `RuntimeReversiblePoliciesCard` — Read-only Matrix mit window + inverse handler.
- `RuntimeEvidenceDrawer` erweitert: gelbe Rollback-Card oben (sichtbar wenn status=completed AND nicht is_rollback). AlertDialog mit Reason-Pflicht (≥8). Bei Erfolg: invalidates evidence-chain + history. Server validiert Reversibility/Window — UI ist optimistisch.

## Invarianten
- Simulation ist STABLE, mutiert nie. Audit-Marker pro Simulation für Compliance.
- Rollback-Chain bleibt zweischichtig (1 Rollback pro Original). Forward-Replay via neuer Dispatch.
- Status-Update der Original-Row auf `rolled_back` ist der einzige Pfad, der die Status-Maschine außerhalb des Dispatchers berührt (per SECURITY DEFINER RPC).

## Smoke
- `SELECT admin_runtime_action_simulate('freeze_policy','{"policy_key":"test"}')` → risk_score 70 (HIGH 50 + dangerous 10 + nicht-reversibel-Warnung 10), reversible=true, blast_radius.affected_policy_keys=1.
- `SELECT admin_runtime_action_rollback('<non-existing>','x')` → "result not found" / forbidden.

## Verwandt
- mem://architektur/ops/safe-actions-dispatcher-v1
- mem://architektur/ops/runtime-command-center-observability-v1-1
