---
name: Safe Actions Dispatcher v1
description: fn_runtime_action_execute SSOT-Dispatcher mit validate→snapshot_before→execute→snapshot_after→audit→rollback_ref für 8 Handler. Idempotency-Key (15min-bucket) + synchronous execute aus admin_dispatch_runtime_safe_action.
type: feature
---

# Safe Actions Dispatcher v1

## Contract
`request → validate → snapshot_before → execute → snapshot_after → result → audit → rollback_ref`

## Schema-Erweiterungen
- `runtime_action_results.idempotency_key` (UNIQUE WHERE NOT NULL) — key = `action_key|sha256(payload)|YYYYMMDDHHMM-15min-bucket`
- `ai_eval_datasets.is_enabled` boolean default true
- `policy_freeze_state(policy_key PK, frozen_until, reason, frozen_by)` — admin read / service_role write
- `alert_silences(alert_key PK, silenced_until, reason, silenced_by)` — admin read / service_role write

## Dispatcher
`public.fn_runtime_action_execute(_result_id uuid)` — service_role only, SECURITY DEFINER.
- locks `runtime_action_results` FOR UPDATE, skip wenn status≠pending (idempotent)
- setzt status=running, CASE über action_key
- bei Erfolg: füllt before/after/outcome/duration_ms/completed_at + emit `runtime_safe_action_completed`
- bei Fehler: status=failed, error=SQLERRM + emit `runtime_safe_action_failed`
- ruft `fn_emit_audit` mit vollständigen named args (_action_type, _target_type, _target_id, _result_status, _payload, _trigger_source, _error_message)

## Handler-Matrix
| action_key | Side-Effect | rollback_ref |
|---|---|---|
| re_run_eval_window | Audit-Marker; ai-eval-worker-6h Cron pickt up | — |
| rollback_policy | `fn_rollback_policy_version(version_id)` | neue version_id |
| freeze_policy | UPSERT `policy_freeze_state` (default +24h) | — |
| disable_dataset | `ai_eval_datasets.is_enabled=false` | — |
| recompute_sequence | `fn_compute_adaptive_sequence(user_id, curriculum_id)` row-count | — |
| silence_alert | UPSERT `alert_silences` (default +4h) | — |
| trigger_intervention_recheck | Audit-Marker für Intervention-Worker | — |
| open_evidence_chain | Read-only: `auto_heal_log` ≤50 rows zu target_id | — |

## Wiring
`admin_dispatch_runtime_safe_action` (authenticated, has_role-gated):
1. validate has_role + reason≥8 wenn requires_reason
2. compute idempotency_key; bei Existenz → return existing id
3. INSERT pending
4. emit `runtime_safe_action_dispatched`
5. **synchronous** `fn_runtime_action_execute(result_id)` — Operator sieht Outcome sofort

## Smoke 2026-05-21
`open_evidence_chain` (kein payload) → status=completed, chain_count=50, duration_ms≈11.6s (auto_heal_log full-scan; in Prod via target_id≠NULL bound).

## Bekannte Lücken
- `re_run_eval_window` + `trigger_intervention_recheck` schreiben aktuell nur Audit; echte Worker-Enqueue folgt wenn die Worker auf system_intents migriert sind
- Kein automatischer Rollback-Walk in `policy_rollback_snapshots` (manuell via `rollback_policy` mit payload.version_id)
- `open_evidence_chain` ohne `target_id` scant LIMIT 50 über alle auto_heal_log — UI sollte target_id immer mitsenden

## Verwandt
- mem://architektur/ops/safe-actions-framework-v1
- mem://architektur/ops/ai-runtime-command-center-v1
