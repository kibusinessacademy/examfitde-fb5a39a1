---
name: Runtime Command Center Observability v1.1
description: v_runtime_action_history SSOT + 4 Admin-RPCs (history/detail/evidence/failures) + deterministic Diff-Engine + Actions/Failures/Evidence-Drawer im /admin/runtime Cockpit + 4 statische Invarianten.
type: feature
---

# Runtime Command Center Observability v1.1 (2026-05-21)

Baut auf Safe Actions Dispatcher v1 auf. Macht aus Operator-Intent **operationale Sichtbarkeit**: jede Mutation, jeden Diff, jede Evidence-Chain, jede Failure-Klasse einsehbar — ohne neue Dispatcher, ohne Shadow-State.

## Phase 1 — SSOT Ledger View
`public.v_runtime_action_history` (append-only, derived; locked to service_role):
- runtime_action_id, created_at, completed_at, operator, action_type, target_type, target_id
- status, risk_level, requires_second_confirm, rollback_supported, dangerous_action
- idempotency_key, duration_ms, validation_status, execution_status
- rollback_available, rollback_ref, evidence_chain_id
- snapshot_size_before/after (pg_column_size), mutation_count, warning_count, error_count
- guard_fail_reason, result_summary, reason, severity, payload

## Phase 3 — RPCs (SECURITY DEFINER + has_role('admin'))
- `admin_get_runtime_action_history(limit,status,risk,action,search)` — cap 500, ILIKE-Search auf action/target/summary
- `admin_get_runtime_action_detail(uuid) → jsonb` — vollständiges Record + Governance-Flags
- `admin_get_runtime_evidence_chain(uuid) → jsonb` — evidence rows + auto_heal_log audit trail (Time-Window action.created_at-5min … completed_at+30min, gefiltert auf target_id/result_id) + before/after snapshots + outcome
- `admin_get_runtime_action_failures(window_hours) → jsonb` — by_status/by_risk/top_failing_handlers/idempotent_hits

REVOKE ALL FROM PUBLIC,anon; GRANT EXECUTE TO authenticated (Gate via `has_role`).

## Phase 5 — Risk & Governance
`runtime_safe_actions` erweitert um `risk_level` (LOW/MEDIUM/HIGH/CRITICAL, CHECK), `requires_second_confirm`, `rollback_supported`, `dangerous_action`. Seed-Matrix:

| action_key | risk | second_confirm | rollback | dangerous |
|---|---|---|---|---|
| open_evidence_chain | LOW | – | – | – |
| re_run_eval_window | LOW | – | – | – |
| recompute_sequence | MEDIUM | – | – | – |
| silence_alert | MEDIUM | – | – | – |
| trigger_intervention_recheck | MEDIUM | – | – | – |
| rollback_policy | HIGH | ✓ | ✓ | ✓ |
| freeze_policy | HIGH | ✓ | – | ✓ |
| disable_dataset | HIGH | ✓ | – | ✓ |

## Phase 2 — Diff Engine SSOT
`src/lib/runtime/diff/runtimeDiff.ts` — Pure, deterministic, audit-safe:
- `buildRuntimeDiff(before, after)` — stable sort by path, depth-first walk, redacts SECRET_KEYS
- `summarizeRuntimeDiff(diff)` — `+N added · ~M changed · ⚠ critical`
- `detectCriticalMutation(diff)` — true bei publish_state_change / escalation / dag_unlock
- Klassifikation: status_change · queue_change · job_count_change · flag_change · retry_change · escalation_change · priority_change · dag_unlock · publish_state_change · value_change
- Invariante: keine `Date.now()` / `Math.random()` (durch Static Guard erzwungen)

## Phase 4 — UI Tabs (/admin/runtime)
Neue Tabs **vor** den bestehenden Layer-Tabs:
1. **Actions** (`RuntimeActionsLedgerCard`) — gefilterte Ledger-Table mit search/status/risk-Filter, Idempotenz-/Rollback-/Risk-Badges, Evidence-Drawer
2. **Failures** (`RuntimeFailuresCard`) — 1h/24h/7d-Window, by_status/by_risk, top failing handlers, idempotent_hits

**Evidence Drawer** (`RuntimeEvidenceDrawer`) als Dialog: Lifecycle-Timeline (validate→snapshot_before→execute→snapshot_after→audit), Diff-Inspector (max 30 entries, critical highlighted), Evidence-Liste, Audit-Trail (max 100).

Bestehende Tabs unverändert: Health · Governance · Sequencing · Observability · Intervention · Safe Actions. SafeActions-TabsContent jetzt korrekt gewired (vorher Import ohne Render).

## Phase 6 — Tests & Guards
- `src/lib/runtime/diff/__tests__/runtimeDiff.test.ts` — 5 Tests: identity, determinism, critical publish, secret redact, classification matrix
- `scripts/guards/runtime-observability-invariants.mjs` — 4 statische Invarianten:
  - RUNTIME_ACTION_NO_DELETE (kein DELETE/TRUNCATE auf runtime_action_results/evidence)
  - RUNTIME_AUDIT_APPEND_ONLY (kein UPDATE auf auto_heal_log außerhalb migrations)
  - RUNTIME_DIFF_NO_RANDOMNESS (Date.now/Math.random in runtimeDiff.ts verboten)
  - RUNTIME_EVIDENCE_NO_SECRET_FIELDS (kein console.* im EvidenceDrawer)

## Phase 8 — Future Hooks (typed contracts only)
`src/features/admin/runtime/types.ts` deklariert: `RuntimeRollbackPlan`, `RuntimeAutoApprovalPolicy`, `RuntimeSimulationRequest`, `RuntimeIncidentSummary`, `RuntimeMultiApproval`. Keine Implementierung — Extension-Points für spätere Cuts (Rollback-Runner, Dry-Run, Replay, AI-Summaries, Multi-Operator-Approvals).

## Invarianten (nicht verhandelbar)
- Append-only: keine UPDATE/DELETE auf Audit/Action-Tabellen aus UI
- View hidden vor anon/authenticated; nur via has_role-RPC
- Diff deterministisch + redact-by-key
- Frontend hält keinen Wahrheits-State — alle Quellen via RPC

## Smoke
SELECT count(*) FROM public.v_runtime_action_history → 1 row (vorhandener open_evidence_chain Smoke aus Dispatcher-v1).

## Verwandt
- `mem://architektur/ops/safe-actions-framework-v1`
- `mem://architektur/ops/safe-actions-dispatcher-v1`
- `mem://architektur/ops/ai-runtime-command-center-v1`
- `mem://constraints/admin-ui-leitstelle-v1`
