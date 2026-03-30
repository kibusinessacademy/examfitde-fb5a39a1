# Memory: architektur/pipeline/step-loop-guard-governance
Updated: now

Das 'Step-Loop-Guard' System wurde auf ein **Delta-basiertes Guard-Modell** (v2) umgestellt. Für `validate_exam_pool` gilt nicht mehr die reine Attempt-Zählung, sondern eine 4-stufige State Machine:

## Guard States
1. **healthy**: Fortschritt sichtbar (delta_approved > 0 ODER delta_unresolved_flags < 0 ODER delta_missing_lf < 0)
2. **recovering**: Repair aktiv oder Grace-Period läuft → kein Block
3. **soft_stalled**: Kein Fortschritt über mehrere Zyklen, aber noch recovery-fähig → Repair wird enqueued + Grace-Window gesetzt
4. **hard_stalled**: Kein Fortschritt nach mehreren Repair-Versuchen + Grace abgelaufen + keine aktiven Jobs → deterministischer Block mit Reason Code `VALIDATE_EXAM_POOL_TRUE_STALL`

## Architektur (5 Schichten)
1. **Snapshot-SSOT**: Tabelle `exam_pool_validation_snapshots` erfasst pro Validierungslauf alle Pool-Metriken (approved, review, draft, rejected, unresolved_quality_flags, missing_lf_coverage, etc.)
2. **Klassifikations-Funktion**: `fn_classify_validate_guard(package_id)` berechnet aus den letzten zwei Snapshots + aktiven Jobs + Grace + Leases den Guard-State
3. **Metrics-RPC**: `get_exam_pool_validation_metrics(package_id, curriculum_id)` sammelt live Pool-Metriken (QC-Status-Counts, LF/Kompetenz-Coverage, Trap/Bloom-Metadata-Gaps)
4. **Loop-Guard Override**: Für `stepKey === 'validate_exam_pool'` nutzt `checkLoopGuard()` die DB-Funktion statt generischer Schwellwerte. Hard-Block nur bei `guard_state = 'hard_stalled'`. Alle anderen Zustände erlauben Weiterarbeit.
5. **Healer**: `healValidateExamPoolLoop()` in stuck-scan nutzt dieselbe Klassifikation. soft_stalled → enqueue_repair + Grace-Window. healthy/recovering bei blocked step → False-Positive-Heal. hard_stalled → deterministischer Block.

## Snapshot Write-Path (Phase 2)
Der Validator (`package-validate-exam-pool`) führt nach jedem Lauf den vollständigen Write-Path aus:
1. `loadExamPoolMetrics()` via RPC → aktuelle Pool-Metriken
2. `insertExamPoolSnapshot()` → Roh-Snapshot schreiben
3. `classifyValidateGuard()` → Guard-State live berechnen (sieht den neuen Snapshot)
4. `finalizeExamPoolSnapshot()` → guard_state + reason_code im Snapshot updaten
5. `updateValidateExamPoolStepMeta()` → consecutive_no_progress, last_progress_delta, guard_state in step.meta

Dieser Pfad wird **sowohl** im Gate-Blocked-Pfad (no pending questions) **als auch** im normalen Validierungsergebnis ausgeführt. Pro Lauf entsteht genau ein Snapshot.

## Reason Codes
- `VALIDATE_EXAM_POOL_SOFT_STALL`: Kein Fortschritt, Repair noch nicht versucht
- `VALIDATE_EXAM_POOL_TRUE_STALL`: Echter Stillstand nach mehreren Repair-Zyklen
- `NO_PROGRESS_AFTER_REPAIR`: Repair lief, aber kein Delta sichtbar
- `REPAIR_RUNNING_AWAITING_DELTA`: Aktive Jobs/Lease vorhanden
- `RECENT_HEAL_GRACE_ACTIVE`: Grace-Period nach Repair noch aktiv

## UI/Leitstelle
`ValidateGuardDiagnosticsCard` in der Leitstelle zeigt pro Paket: Guard-State (farbcodiert), Reason-Code, Deltas, Attempts, aktive Jobs, Grace-Timer, empfohlene Aktion.
