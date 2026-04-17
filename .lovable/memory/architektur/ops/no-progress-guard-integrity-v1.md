---
name: No-Progress-Guard für Integrity-Check v1
description: Verhindert QUALITY_THRESHOLD_NOT_MET Endlos-Loops indem Pakete nach 3 fehlgeschlagenen Integrity-Runs ohne Score-Verbesserung (≥3 Punkte) automatisch auf blocked=quality_no_progress_3x gesetzt werden
type: feature
---

# No-Progress-Guard für Integrity-Check (Option A)

## Problem
Pakete mit strukturellen Quality-Defiziten (zB 0% conflict_type, fehlende Kompetenzen) liefen in `package_run_integrity_check` → `package_repair_exam_pool_quality` → `package_run_integrity_check` Endlos-Schleifen. 99 failed Jobs in 24h, gleicher Score.

## Lösung
1. **Tabelle `integrity_check_history`**: jeder Run wird mit Score, hard_fails, trigger_source persistiert.
2. **Function `fn_record_integrity_run_and_check_progress(p_package_id, p_curriculum_id, p_score, p_passed, p_hard_fails, ...)`**:
   - Insertet Run.
   - Wenn passed → kein Block.
   - Wenn published → kein Block (Depublish-Logik liegt woanders).
   - Sonst: letzte 3 FAILED Scores → wenn `max - min < 3 Punkte` → BLOCK.
3. **Block-Aktion**:
   - `course_packages.status = 'blocked'`, `blocked_reason = 'quality_no_progress_3x'`
   - Alle pending/processing `package_run_integrity_check`, `package_repair_exam_pool*`, `package_validate_exam_pool` → `cancelled` mit `cancel_reason='quality_no_progress_3x'`
   - `admin_notifications` Eintrag (severity=error)
   - `admin_actions` Audit-Log
4. **Edge-Function-Patch in `package-run-integrity-check/index.ts`**: nach Score-Berechnung wird die RPC aufgerufen; bei `no_progress_block=true` wird `status=blocked` geschrieben und die Function returned früh — keine weiteren Status-Klassifikations- oder Auto-Requeue-Pfade laufen.

## Parameter
- `p_window = 3` (3 Runs)
- `p_min_improvement = 3` (Score muss um ≥3 Punkte schwanken)

## Recovery
Admin muss manuell entsperren (z.B. via `recoverAndReenterPackage` oder direkten Repair mit anderem Mode wie `hard_rebuild_pool`). Nach Unblock startet History wieder bei 0 Failed-Runs in der Window.

## Schutz vor False-Positives
- Mindestens 3 Failed-Runs nötig (insufficient_history → kein Block).
- Score-Verbesserung von 3 Punkten reicht zum "Reset" der Stagnation.
- Published Packages werden ausgenommen (Depublish-Schutz lebt im Hollow-Publish-Guard).
