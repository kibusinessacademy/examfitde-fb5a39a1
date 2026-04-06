# Memory: architektur/pipeline/validate-exam-pool-multi-gate-v1
Updated: now

## Dauermaßnahme 2: Mehrstufiges Gate für validate_exam_pool

`validate_exam_pool` verwendet ab sofort ein 4-stufiges Gate-Klassifikationsmodell statt binärem pass/fail.

## Gate-Stufen (fn_classify_exam_pool_gate)

1. **PASS**: Pool ist ausreichend und konsistent (≥50 eligible, LF ≥80%, Comp ≥70%, unresolved <5%)
2. **WAITING_FOR_MATERIALIZATION**: Upstream-Jobs aktiv, Repair läuft, pending QC >10%, oder Draft-Ratio >15% → kein Fehler, Requeue mit Backoff
3. **REPAIRABLE**: Echte Lücken (LF-Coverage, QC-Reconciliation, Kompetenz-Coverage), aber SSOT intakt → Targeted Repair
4. **HARD_FAIL**: Keine Fragen ohne aktive Generation, SSOT fehlt, oder 3+ wirkungslose Repairs in 2h → Manuelles Review

## Reason Codes
- `HARD_FAIL_NO_CURRICULUM`, `HARD_FAIL_NO_BLUEPRINTS`, `HARD_FAIL_SSOT_MISSING`, `HARD_FAIL_REPAIR_EXHAUSTED`
- `UPSTREAM_GENERATION_ACTIVE`, `REPAIR_IN_PROGRESS`, `PENDING_QC_HIGH`, `DRAFT_RATIO_HIGH`
- `REPAIR_LF_COVERAGE`, `REPAIR_COMPETENCY_COVERAGE`, `REPAIR_QC_RECONCILIATION`, `REPAIR_INSUFFICIENT_QUESTIONS`

## Architektur
- **DB-Funktion** `fn_classify_exam_pool_gate(package_id uuid)` → kanonischer Gate-Entscheider (JSONB-Return)
- **Ops-View** `ops_validate_exam_pool_status` → Echtzeit-Dashboard aller Pakete mit Gate-Status, Metriken, empfohlener Aktion
- **Edge Function** `package-validate-exam-pool` ruft fn_classify_exam_pool_gate als Pre-Gate auf; nur bei PASS+pending oder REPAIRABLE+pending → T1/T2 Validation

## Repair-Loop-Guard
No-Effect-Detection: Vergleicht letzte 2 Snapshots innerhalb 2h-Fenster. Bei ≥3 Snapshots ohne Metrik-Änderung (delta_approved <2, delta_lf <1) → `HARD_FAIL_REPAIR_EXHAUSTED`.

## Snapshot-Erweiterung
`exam_pool_validation_snapshots` erweitert um `gate_class` und `repair_attempts_24h` für historisches Tracking.
