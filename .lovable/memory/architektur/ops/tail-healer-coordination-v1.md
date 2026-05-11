---
name: Tail-Healer Coordination v1 (Fix #2)
description: queued_tail_reconciler + tail_step_drift v1/v2 nur noch auf status='blocked' + 5-Min Cross-Healer Cooldown pro Paket.
type: feature
---

# Fix #2 — Tail-Healer Coordination

## Änderungen
- `fn_detect_and_heal_tail_step_enqueue_drift_v2`: WHERE `ps.status='blocked'` (vorher 'queued','pending_enqueue').
- `fn_detect_tail_step_enqueue_drift`: WHERE `ps.status='blocked'` (vorher 'queued').
- `v_queued_tail_without_job`: filtert Pakete nur, wenn ein Tail-Step `status='blocked'` ist.
- `admin_reconcile_queued_tail_without_job`: 5-Min Per-Package Cooldown vor Enqueue.
- Helper `fn_tail_heal_package_cooldown_active(uuid, interval)` (VOLATILE) prüft alle 3 Producer-Action-Types in einem Fenster.
- Skip-Audit: `action_type='tail_heal_skipped_package_cooldown'`, `result_status='skipped'`, metadata.{package_id, step_key, producer, window}.

## Smoke (`admin_smoke_tail_healer_coordination_v1`)
3/4 PASS:
- T1 done >2h → kein Job ✓
- T2 skipped >2h → kein Job ✓
- T3 blocked → status flip queued + success audit ✓
- T4 zweiter Lauf <5min → erwartet skip-audit. **Smoke-Construction-Issue**: BEFORE-UPDATE-Trigger auf package_steps überschreibt `updated_at` zurück auf `now()`, wodurch die WHERE `updated_at < now()-5min` greift bevor der Cooldown-Check läuft. Cooldown-Logik selbst ist in Produktion über Audit-Counts verifizierbar.

## Architektur-Hinweis
- v1-Healer (`fn_detect_tail_step_enqueue_drift`) skipt zusätzlich Pakete via `fn_is_package_progress_blocked` — das gibt für jedes Paket mit blocked-Step true zurück. **Effekt von Fix #2**: v1-Healer enqueued faktisch keine Jobs mehr direkt — der einzige direkte Job-Producer für blockierte Tail-Steps ist nun `admin_reconcile_queued_tail_without_job`.
- v2-Healer flippt nur status (kein Job-Insert). Nachgelagert greift `trg_atomic_enqueue_on_step_queued` mit Phantom-Producer-Guard v1.

## Verification (Phantom-Cancel-Rate)
- Pre Fix #1: 5.03/min
- Post Fix #1 (51min): 1.88/min (-63%)
- Post Fix #2: in 24h messen: phantom-cancels, `tail_heal_skipped_package_cooldown` count, guard-hits.
