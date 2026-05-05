---
name: auto_heal_log canonical schema migration complete
description: Letzter Legacy-Producer (admin_didaktik_heal_packages, details→metadata) am 2026-05-05 migriert. v_auto_heal_log_legacy_producers zeigt 0 echte Legacy-Schreibmuster. Hard-Block-Trigger trg_guard_auto_heal_log_schema kann am 2026-05-08 ohne Risiko aktiviert werden.
type: feature
---

## Stand 2026-05-05

- `v_auto_heal_log_legacy_producers` listet 159 Funktionen die in `auto_heal_log` schreiben — alle 159 nutzen das **canonical Schema** (action_type, trigger_source, target_type, target_id, result_status, metadata).
- Letzter Producer mit `bad_details_col=true` war `admin_didaktik_heal_packages` (nutzte `details` statt `metadata`) — am 2026-05-05 fixed.
- BEFORE INSERT Trigger `trg_guard_auto_heal_log_schema` ist scharf, wirft RAISE EXCEPTION wenn `action_type IS NULL`.
- Hard-Block-Umstieg geplant 2026-05-08 — kein Risiko mehr.

## Audit-Pfad
- `admin_get_audit_reports_summary()` → AuditReportsPage zeigt Coupling = 0 echte Legacy-Producer.
- `admin_test_auto_heal_log_schema_guard()` (Edge-Func admin-test-auto-heal-log-guard) verifiziert Trigger-Verhalten.

## Lessons Learned
- "159 Producer" war irreführend — die View listet alle Funktionen die `auto_heal_log` schreiben, nicht nur fehlerhafte. Filter `bad_payload OR bad_triggered_by OR bad_action_col OR bad_package_id_col OR bad_details_col` zeigt das echte Risiko.
- AuditReportsPage sollte beide Counts zeigen: total_producers + with_legacy_pattern.
