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
3. **Loop-Guard Override**: Für `stepKey === 'validate_exam_pool'` nutzt `checkLoopGuard()` die DB-Funktion statt generischer Schwellwerte. Hard-Block nur bei `guard_state = 'hard_stalled'`. Alle anderen Zustände erlauben Weiterarbeit.
4. **Healer**: `healValidateExamPoolLoop()` in stuck-scan nutzt dieselbe Klassifikation. soft_stalled → enqueue_repair + Grace-Window. healthy/recovering bei blocked step → False-Positive-Heal. hard_stalled → deterministischer Block.
5. **Forensik-View**: `ops_validate_exam_pool_progress` zeigt für jedes Paket: Guard-State, Reason-Code, Deltas, Attempts 24h, aktive Jobs, Lease, Grace, Empfehlung.

## Reason Codes
- `VALIDATE_EXAM_POOL_SOFT_STALL`: Kein Fortschritt, Repair noch nicht versucht
- `VALIDATE_EXAM_POOL_TRUE_STALL`: Echter Stillstand nach mehreren Repair-Zyklen
- `NO_PROGRESS_AFTER_REPAIR`: Repair lief, aber kein Delta sichtbar
- `REPAIR_RUNNING_AWAITING_DELTA`: Aktive Jobs/Lease vorhanden
- `RECENT_HEAL_GRACE_ACTIVE`: Grace-Period nach Repair noch aktiv

## UI/Leitstelle
`ValidateGuardDiagnosticsCard` in der Leitstelle zeigt pro Paket: Guard-State (farbcodiert), Reason-Code, Deltas, Attempts, aktive Jobs, Grace-Timer, empfohlene Aktion.
