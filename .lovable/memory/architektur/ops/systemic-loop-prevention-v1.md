---
name: Systemische Loop-Prevention (NO_PROGRESS + DAG-Memory + system_intents)
description: 3 systemische Fixes statt Symptombehandlung. NO_PROGRESS_TERMINAL beendet Repair-No-Op-Loops endgültig. DAG-Guard mit Block-Signature-Memory eskaliert wiederholte Blocks zum step=blocked. system_intents-Tabelle bietet idempotenten Routing-Layer für die 93 konkurrierenden Crons.
type: feature
---

## Kontext (Forensik 7d)
- 166k Heal-Logs vs 11k Jobs → Control-Plane > Data-Plane
- 17% Cancelled = Fehltriggerung, nicht Fehler
- Top-Loops alle Varianten desselben Musters: fehlende zentrale Entscheidungsinstanz

## Fixes

### 1) NO_PROGRESS_TERMINAL
- `fn_check_repair_no_progress_and_block(pkg, step_key, action_type, window, min_runs)` prüft letzte N Repair-Audits (target_id ODER metadata.package_id). Alle 0 promoted/rebalanced/traps/bloom/qc → step=`blocked`, last_error `NO_PROGRESS_TERMINAL`, course_packages.blocked_reason ergänzt.
- `trg_after_repair_audit_check_progress` AFTER INSERT auf `auto_heal_log` WHEN action_type='repair_exam_pool_quality' triggert die Prüfung automatisch.

### 2) DAG-Guard mit Memory
- `fn_guard_dag_prerequisites` erweitert um `block_signature = sha256(pkg+step+missing_deps)`. Bei ≥50 identischen Signatures in 1h → step=`blocked`, reason `DAG_GUARD_LOOP_DETECTED`. Audit `dag_guard_loop_detected`.
- Index `idx_auto_heal_log_dag_signature` auf metadata->>'signature' + created_at (partial WHERE action_type='dag_guard_block').
- Nutzt `extensions.digest` (pgcrypto in extensions schema).

### 3) system_intents Routing-Layer
- Tabelle `system_intents(id, intent_type, package_id, priority, payload, signature, source, claimed_at, claimed_by, consumed_at, result)`.
- Unique Index `uq_system_intents_open_signature` WHERE consumed_at IS NULL → Idempotency.
- RPCs: `system_intent_record(type, pkg, prio, payload, source)` (Crons), `system_intent_claim_next(worker, types[])` mit FOR UPDATE SKIP LOCKED, `system_intent_complete(id, result)`.
- RLS aktiviert, nur service_role Vollzugriff.

## Migration-Reihenfolge für Crons (Phase 2)
Ersetze direkte Cron→Worker-Aufrufe schrittweise durch `system_intent_record(...)`. Worker pollen via `system_intent_claim_next()`. So verschwindet Cron-Doppeltriggerung strukturell.
