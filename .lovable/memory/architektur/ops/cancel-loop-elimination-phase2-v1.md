---
name: Cancel-Loop-Elimination Phase 2 (3-Fix-Bundle)
description: Pre-Enqueue-SSOT-Guard + erweiterte Hot-Loop-Quarantäne für cancelled + Pre-Run-Step-Finalized-Guard zur Eliminierung deterministischer Cancel-Cluster
type: feature
---

# Cancel-Loop-Elimination Phase 2 — Umgesetzt 2026-04-18

## Diagnose
699 cancelled Jobs in 6h, 4 Cluster:
- **514** `ssot_applicability_guard` (EXAM_FIRST/PLUS, package_generate_learning_content)
- **91** `step_finalized` race (package_generate_exam_pool)
- **88** deterministische HTTP 500 (package_generate_glossary/handbook)
- **19** `BLOCKED_BY_MATERIALIZATION` (Phase-2-Routing wirkt korrekt)

## Fix #1 — Pre-Enqueue-SSOT-Guard + Drift-Bereinigung
- **Migration**: 14 verwaiste Steps in EXAM_FIRST/PLUS auf `skipped` gesetzt (queued → skipped)
- **Trigger** `fn_guard_ssot_applicability` erweitert: erfasst nicht nur `pending`, sondern auch `queued`. Setzt parallel den zugehörigen `package_step` auf `skipped`.
- **Code** in `_shared/stuck-scan-hygiene.ts` (placeholder-reconciliation) und `_shared/pipeline-process.ts` (low-progress-boost): rufen `autoSkipIfNotApplicable` / `isStepApplicableForPackage` vor `enqueueJob` auf — verhindert ~170 sinnlose INSERTs/h.

## Fix #2 — Hot-Loop-Quarantäne auf error-like cancelled erweitert
- **Migration** `fn_check_hot_loop_quarantine`: zählt jetzt `failed` UND `cancelled` mit echtem `last_error`, schließt harmlose Cancel-Reasons aus (`ssot_applicability_guard`, `step_finalized`, `step_finalized_job_obsoleted`, `BLOCKED_BY_MATERIALIZATION%`, `package_exit_building`, `package_not_executable`, `unsigned_cancel`).
- **Neuer Trigger** `trg_check_quarantine_on_error_cancel` (AFTER UPDATE): ruft die Quarantäne-Prüfung automatisch bei error-like Cancels auf — fail-open. Schließt die Lücke zu `_shared/job-fail.ts` (welches nur den `failed`-Pfad abdeckt).

## Fix #3 — Pre-Run-Step-Finalized-Guard
- **Code** in `job-runner/index.ts` (vor Dispatch, nach Lease-Guard): Prüft `package_steps.status` für den Ziel-Step. Wenn `done`/`skipped` → Job wird mit `cancel_reason='step_finalized_pre_run'` beendet, ohne Slot zu verbrennen.

## Invarianten
- Phase 2 (Hot-Loop-Quarantäne) und diese Phase sind komplementär: Hot-Loop blockt 5+ identische Failures pro 30min, Pre-Enqueue-Guards verhindern dass es überhaupt soweit kommt.
- Trigger-Guards sind defensive Schicht (fangen ab), Code-Guards sind proaktive Schicht (verhindern).
- Alle harmlosen Cancel-Reasons sind explizit ausgeschlossen — keine Quarantäne-Treffer durch SSOT/Materialization/Step-Finalized.

## Erwartete Wirkung
- 514 `ssot_applicability_guard` Cancels/6h → ~0 (Caller blockt vor INSERT)
- 88 `HTTP 500` Cancels/6h → Quarantäne nach 5 Treffern in 30min
- 91 `step_finalized` race Cancels → reduziert durch Pre-Run-Guard
- Ergebnis: deutlich höhere claim-to-completion Ratio, sauberere Failure-Statistik
