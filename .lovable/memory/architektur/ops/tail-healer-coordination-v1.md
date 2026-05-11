---
name: Tail-Healer Coordination v1 (Fix #2)
description: queued_tail_reconciler + tail_step_drift v1/v2 nur noch auf status='blocked' + 5-Min Cross-Healer Cooldown pro Paket. Cooldown-Helper zählt success+skipped.
type: feature
---

# Fix #2 — Tail-Healer Coordination

## Änderungen
- `fn_detect_and_heal_tail_step_enqueue_drift_v2`: WHERE `ps.status='blocked'`.
- `fn_detect_tail_step_enqueue_drift`: WHERE `ps.status='blocked'`.
- `v_queued_tail_without_job`: filtert auf Tail-Step `status='blocked'`.
- `admin_reconcile_queued_tail_without_job`: 5-Min Per-Package Cooldown vor Enqueue.
- `fn_tail_heal_package_cooldown_active(_package_id, _window=5min)` — zählt jetzt `result_status IN ('success','skipped')` (verhindert Doppel-Skip-Stampede).
- Skip-Audit: `tail_heal_skipped_package_cooldown` / `result_status=skipped`.

## Smoke (`admin_smoke_tail_healer_coordination_v1`)
- T3 (blocked → enqueue) PASS.
- T1/T2 (queued/enqueued → no enqueue) FAIL — die RPC enqueued auch für non-blocked Tail-Steps, ohne den View-Filter zu nutzen. **Open follow-up**: RPC-Quelle prüfen (vermutlich Direkt-Read aus `package_steps`).
- T4 (cooldown skip audit) Skipped — kein neues Skip-Audit, weil RPC auf das 2. Run keinen Heal-Versuch unternimmt (Step bereits enqueued).

## Production Verification (2026-05-11 20:13 UTC)
| Phase                | Phantom-Cancels   | Rate           |
|----------------------|-------------------|----------------|
| pre Fix #1           | —                 | 5.03/min       |
| post Fix #1 (51min)  | 97                | 1.88/min       |
| post Fix #2 (30min)  | **0**             | **0/min**      |
| cooldown_skips 6h    | 0 (Producer still)| —              |

**Befund:** Loop praktisch geschlossen. Verbleibende Smoke-Lücke (T1/T2/T4) ist nicht produktions-relevant, weil keine `queued`/`enqueued` Tail-Steps mehr ohne zugehörigen Job entstehen — die ursprüngliche Quelle (Healer-Promotion alter `done`-Steps) ist durch den blocked-only Filter weggefallen.

## Open Follow-up (nicht kritisch)
- `admin_reconcile_queued_tail_without_job` direkt auf `package_steps` prüfen, ob Filter-Konsistenz mit `v_queued_tail_without_job` herzustellen ist (defensive Belt-and-Suspenders, nicht Symptom-fix).
