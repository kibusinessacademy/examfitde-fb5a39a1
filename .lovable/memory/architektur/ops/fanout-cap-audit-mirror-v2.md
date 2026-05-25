---
name: fanout-cap-audit-mirror-v2
description: fn_enforce_global_fanout_cap hardened — fn_emit_audit + trigger_source + tightened required_keys
type: feature
---

# fn_enforce_global_fanout_cap v2 (Audit-Mirror Hardening)

**Datum:** 2026-05-25 · **Baseline lifetime suppressions:** 7308 · **Letzte 7d:** ~264

## Was sich geändert hat
- BEFORE-INSERT Guard `trg_enforce_global_fanout_cap` auf `job_queue` bleibt identisch im Verhalten (cap=3 pro `(package_id, job_type[, learning_field_filter])`, RETURN NULL).
- **SSOT** bleibt `ops_guardrail_events.fanout_cap_blocked` via `fn_log_guardrail_event`.
- **Audit-Mirror** schreibt jetzt über zentralen `fn_emit_audit('job_queue_insert_suppressed_fanout_cap', ...)` statt direktem INSERT in `auto_heal_log` — inklusive `trigger_source='fn_enforce_global_fanout_cap'` und `mirror_of='ops_guardrail_events.fanout_cap_blocked'`.
- **ops_audit_contract** verschärft: `required_keys={reason, job_type, pending_count, cap, scope, cap_key}`.
- Mirror bleibt best-effort (`EXCEPTION WHEN OTHERS THEN NULL`) — Guard verliert nie wegen Audit-Failure.

## Smoke
- Contract: ✅ required_keys gesetzt
- Function source enthält `fn_emit_audit`: ✅
- Deployment-Audit `fanout_cap_audit_enrichment_deployed` v2: ✅ 2026-05-25 10:53 UTC

## Pattern-Folgekandidaten (gleicher Audit-Mirror-Refactor)
- `trg_guard_continuation_enqueue_cap`
- `trg_guard_phantom_repair_enqueue`
- `trg_guard_redundant_seeding` (action_type schon registriert)
- `trg_guard_pool_fill_producer_cooldown`
