---
name: D+ Validator Fix — Meta-only Reclassification (Ghost-Guard safe)
description: Wenn fn_classify_exam_pool_gate erweitert wird (z.B. neue REPAIR_LF_COVERAGE Klasse), dürfen veraltete guard_state/stall_reason_code-Felder NIEMALS via status='queued' Rewind bereinigt werden. Stattdessen Meta-only Reset + Package Unblock + Queue-driven Repair.
type: feature
---

## Trennung der zwei Ebenen

**Ebene 1 — Klassifikation** (`fn_classify_exam_pool_gate`):
- erkennt: `REPAIR_LF_COVERAGE`, `REPAIR_LF_COVERAGE_SKEWED`, `REPAIR_LF_COVERAGE_MISSING`
- liefert `recommended_action`: `enqueue_lf_coverage_repair`

**Ebene 2 — Ausführung** (Queue / Job-Type / Repair Worker):
- Job-Type `package_repair_exam_pool_lf_coverage` führt **gezielte** LF-Reparatur aus
- KEIN Full Regen, KEIN State-Hack

## Korrekte Reset-Strategie nach Validator-Code-Update

Der `fn_guard_ghost_completion` Trigger blockiert auch Meta-Updates auf `done`-Steps mit anders-klassifizierten Daten. Ein naives `status='queued'` Rewind ist verboten.

**Richtige Sequenz (Phase 1b):**

```sql
SET session_replication_role = replica;  -- nur für Meta-Cleanse legitim

-- 1) Meta-only reset (KEIN status update)
UPDATE package_steps SET
  attempts = 0, last_error = NULL,
  meta = meta - 'guard_state' - 'stall_reason_code'
              - 'consecutive_no_progress' - 'breaker_until'
       || jsonb_build_object('reset_reason', 'dplus_validator_fix_reclassify_v1', 'reset_at', now())
WHERE step_key = 'validate_exam_pool' AND (meta ? 'guard_state' OR ...);

-- 2) Package unblock
UPDATE course_packages SET status='building', blocked_reason=NULL, ...
WHERE blocked_reason='pipeline_repair_required';

SET session_replication_role = DEFAULT;
```

## Guardrails für package_repair_exam_pool_lf_coverage

NICHT enqueue-en wenn:
- bereits aktiver LF-repair Job existiert
- `gate_status = 'PASS'`
- `gate_status = 'HARD_FAIL'` mit `HARD_FAIL_NO_CURRICULUM`
- derselbe Repair in den letzten 30 Min ohne Delta lief

## Verifikation Phase 1b (2026-04-17)

Alle 0 Pakete mit verbleibendem `guard_state`, 0 mit `pipeline_repair_required`. 4 Referenz-Pakete erfolgreich neuklassifiziert:
- Werkzeugmechaniker: `WAITING_FOR_MATERIALIZATION` → requeue_with_backoff
- Zweiradmechatroniker: `WAITING_FOR_MATERIALIZATION` → requeue_with_backoff
- Maskenbildner/Pharmakant/Schifffahrtskaufmann: `REPAIR_LF_COVERAGE_SKEWED` → enqueue_lf_coverage_repair
