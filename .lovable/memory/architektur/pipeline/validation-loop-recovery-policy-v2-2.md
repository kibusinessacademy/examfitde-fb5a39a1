# Memory: architektur/pipeline/validation-loop-recovery-policy-v2-2
Updated: now

Um Sackgassen in der Pipeline ('Validation Loops' oder 'Double Guard Deadlocks') zu vermeiden, darf der Schritt `generate_learning_content` bereits bei einer inhaltlichen Abdeckung von ≥95 % den Status `done` einnehmen. Dies verhindert, dass geringfügige Verarbeitungsrückstände (`needs_regen > 0`) in Kombination mit aggressiven Fertigstellungs-Guards zu Endlos-Resets ('Queued-Spiralen') führen. Verbleibende Inhaltslücken werden als Qualitäts-Themen behandelt, die durch den finalen `run_integrity_check` vor der Veröffentlichung abgesichert werden.

## Systemischer Fix (v3.0 — 3-Schichten Dauerfix)

### Schicht A: DB-Invarianten

1. **`fn_package_learning_content_materialized(package_id)`**: Prüft ob alle Lessons generiert sind (ratio ≥ 95%), needs_regen = 0, und keine aktiven Content-Jobs existieren. Liefert `materialized = true` nur bei voller Artefakt-Realität.

2. **`trg_guard_integrity_report_consistency`**: BEFORE UPDATE Trigger auf `course_packages`, der verhindert, dass `integrity_report_version IS NOT NULL AND integrity_report IS NULL` als gültiger Zustand existiert. Bei Report-Verlust wird die Version automatisch gelöscht und `run_integrity_check` auf `queued` zurückgesetzt.

3. **`fn_is_true_stall(package_id, step_key, stale_minutes)`**: Erkennt echte Stalls: Step ist `queued`, alle DAG-Prereqs sind `done`/`skipped`, kein aktiver Job, und Step ist älter als Schwellwert.

### Schicht B: Runner-/Orchestrator-Härtung (pipeline-handlers.ts)

4. **Artifact-SSOT Override im Loop Guard**: Wenn der Loop Guard `generate_learning_content` blockiert, aber `fn_package_learning_content_materialized` TRUE liefert (100% Lessons, needs_regen=0, keine aktiven Jobs), wird der Block übersprungen und der Step auf `done` gesetzt. Job-Historie wird nie höher gewichtet als Artefakt-Realität.

### Schicht C: Ops/Heal (stuck-scan-hygiene.ts)

5. **`healLoopGuardFalsePositives()`**: Erkennt im 10-Min-Zyklus Steps die durch Loop Guard `blocked` sind, aber vollständig materialisierte Artefakte haben. Override → `done` + Package unblock.

6. **`healIntegrityReportMissing()`**: Erkennt Pakete mit `integrity_report_version` gesetzt aber `integrity_report = NULL`. Auto-clear der Version + Requeue von `run_integrity_check`.

7. **`healTrueStallSteps()`**: Erkennt Steps die `queued` sind, alle Prereqs `done`, kein Job, und stale >15 Min. Bereinigt Meta, löscht `last_error`, setzt `loop_guard_reset_at` und triggert Redispatch. Begrenzt auf 10 Steps/Zyklus.

### Bestehende Mechanismen (v2.2)

8. **Cascade-Reset Härtung**: `fn_is_real_step_regression()` + `trg_cascade_reset_downstream_steps` — nur bei echten Regressionen (`done → queued/failed`)
9. **Material Completion Model**: `shouldFinalize` akzeptiert ≥95% Completion Ratio
10. **`healLearningContentDeadlocks()`**: Nutzt `ops_learning_content_deadlock_candidates` View + `heal_learning_content_deadlock` RPC
11. **`lesson-regen-repair` Worker**: Background-Rework für `needs_regen` Lessons
