---
name: Safe Actions Framework v1
description: runtime_safe_actions/results/evidence SSOT + admin_dispatch_runtime_safe_action RPC + SafeActionsCard im Runtime Command Center (Reason ≥8, Audit-Pflicht).
type: feature
---

# Safe Actions Framework v1

## SSOT-Tabellen
- `runtime_safe_actions` — Registry (action_key UNIQUE, severity, target_layer, requires_reason/evidence/snapshot, is_destructive, dispatch_handler, is_enabled).
- `runtime_action_results` — Execution-Log (status pending/running/completed/failed/rolled_back/cancelled, before_snapshot, after_snapshot, rollback_ref, outcome, error, duration_ms).
- `runtime_action_evidence` — Evidence-Chain pro Result.

## RPCs (SECURITY DEFINER + has_role-Gate)
- `admin_list_runtime_safe_actions()` — Registry für Cockpit.
- `admin_get_runtime_action_results(_limit)` — letzte Ausführungen (cap 500).
- `admin_dispatch_runtime_safe_action(_action_key,_reason,_payload,_severity)` — validiert is_enabled+reason≥8, schreibt Result status='pending', emittiert `fn_emit_audit('runtime_safe_action_dispatched', …)` mit Fallback auf `auto_heal_log`.

## Audit-Contracts (warn-mode)
- `runtime_safe_action_dispatched` (action_key, actor, reason, result_id)
- `runtime_safe_action_completed` (action_key, result_id, duration_ms)
- `runtime_safe_action_failed` (action_key, result_id, error)

## Seed-Actions (8)
re_run_eval_window · rollback_policy · freeze_policy · disable_dataset · recompute_sequence · silence_alert · trigger_intervention_recheck · open_evidence_chain.

## UI
- `src/features/admin/components/SafeActionsCard.tsx` — grouped by target_layer, Severity-Badge, AlertDialog mit Reason-Textarea (min 8), Toast + invalidateQueries; Recent-Results-Liste.
- Eingebunden im `/admin/runtime` Tab "Safe Actions".

## Scope
- Dispatcher-Worker (handler-spezifische Mutationen) folgt im nächsten Cut. Aktuell schreibt RPC nur `pending`-Result + Audit (Operator-Intent dokumentiert, kein Side-Effect).
- Keine Direct-Writes auf `policy_versions`, `ai_eval_datasets`, `adaptive_sequencing_policies` aus der UI.
