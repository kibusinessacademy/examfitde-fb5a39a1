---
name: Audit-Mirror Sister Guards v1
description: 4 Schwesterguards (continuation_cap, phantom_repair, pool_fill_cooldown, redundant_seeding) auf fn_emit_audit-Mirror umgestellt
type: constraint
---

# Audit-Mirror der 4 Schwesterguards

Alle 4 Guards loggen ihre Suppression-/Block-Mirror jetzt einheitlich via `public.fn_emit_audit(action_type,...)` statt direktem `INSERT INTO auto_heal_log`. SSOT bleibt unverändert (Exception, RETURN NULL, ops_guardrail_events). Mirror ist best-effort (`EXCEPTION WHEN OTHERS THEN NULL`).

## Geänderte Funktionen
| Guard | SSOT-Verhalten | Mirror action_type | required_keys |
|---|---|---|---|
| `fn_guard_continuation_enqueue_cap` | RAISE EXCEPTION (CONTINUATION_LOOP_CAP) | `job_queue_insert_suppressed_continuation_cap` | reason, job_type, package_id, origin, recent_count, cap, window_hours |
| `fn_guard_phantom_repair_enqueue` | RAISE EXCEPTION (PHANTOM_REPAIR_BLOCKED) | `job_queue_insert_suppressed_phantom_repair` | reason, job_type, package_id, step_key, step_status, enqueue_source, origin |
| `fn_guard_pool_fill_producer_cooldown` | RETURN NULL (Cooldown 10min) | `job_queue_insert_suppressed_pool_fill_cooldown` | reason, job_type, package_id, curriculum_id, recent_skips, window_minutes, cooldown_until |
| `fn_guard_redundant_seeding` | RETURN NULL + ops_guardrail_events | `job_queue_insert_suppressed_redundant_seeding` | reason, scope, job_type, step_key, package_id, curriculum_id, blueprints, variants, coverage |

Plus Bonus: `fn_guard_phantom_repair_enqueue` und `fn_guard_redundant_seeding` Bypass-Pfade (`phantom_repair_bronze_lift_bypass`, `redundant_seeding_wave_heal_lf_bypass`) ebenfalls auf `fn_emit_audit` umgestellt.

## Warum
Vereinheitlicht 4 weitere Audit-Producer mit `fn_enforce_global_fanout_cap` (v2). Alle Suppressions sind jetzt zentral via `ops_audit_contract.required_keys` validierbar, und CI-Guard `audit-write-contract-guard.mjs` deckt sie ab CUTOFF ab.

## Invariant
`auto_heal_log` darf von diesen Guards niemals direkt mit `INSERT INTO` befüllt werden — immer via `fn_emit_audit`. Mirror-Block ist `BEGIN/EXCEPTION WHEN OTHERS THEN NULL` umschlossen, damit der SSOT-Pfad nie blockiert.
