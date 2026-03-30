# Memory: architektur/pipeline/gate-classified-validation-repair-v1
Updated: now

Das 'Gate-Classified Validation & Repair' System (v1) löst das Problem der diagnoseblinden QG-Validator-/Heal-Schleife durch drei koordinierte Fixes:

## P0.1: Gate-Klassifikation in `package-validate-exam-pool`
Fachliche Hard-Blocker (NO_PENDING_QUESTIONS + UNRESOLVED_QUALITY_FLAGS / MISSING_LF_COVERAGE) werden nicht mehr als retrybare Fehler zurückgegeben, sondern als `gate_blocked: true` mit strukturierten `gate_diagnosis` Codes:
- `REPAIR_NEEDED:QC_RECONCILIATION` → ungelöste QC-Flags erfordern gezielte Bereinigung
- `REPAIR_NEEDED:LF_COVERAGE` → fehlende Lernfeld-Abdeckung erfordert gezielte Ergänzung
- `TERMINAL:POOL_EMPTY` → Pool wirklich leer, Reseed ist korrekt

Der `job-runner` erkennt `gate_blocked` und routet zu `repair_exam_pool_quality` statt blind reseed zu triggern.

## P0.2: Recovery-Mode für `run_integrity_check`
Blocked und quality_gate_failed Pakete dürfen jetzt den Integrity-Check durchlaufen (vorher nur building/done/published). Dies verhindert den Deadlock: blocked → kann keine Diagnose laufen → bleibt blocked. Integrity ist read-only (diagnostisch), daher sicher für alle Status.

## P0.3: Targeted Repair statt Reseed im Healer
`package-repair-exam-pool-quality` führt jetzt eine 3-stufige Reparaturstrategie aus:
1. **QC-Reconciliation**: Stale tier1_failed/needs_revision Fragen (>24h) werden automatisch rejected, wenn der approved Pool ≥500 Fragen hat
2. **Pool-Gesundheits-Check**: Nach Repair wird geprüft ob der Pool clean ist (≥500 approved, 0 unresolved)
3. **LF-Gap-Fill**: Nur bei echten LF-Lücken wird der Filler-Job enqueued

Reseed wird nur noch bei `TERMINAL:POOL_EMPTY` (echte Null-Fragen) erlaubt.
