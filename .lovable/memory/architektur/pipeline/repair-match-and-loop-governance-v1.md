# Memory: architektur/pipeline/repair-match-and-loop-governance-v1
Updated: now

Das System unterliegt einer 'Repair-Match-Governance', um wirkungslose 'Heal-Loops' (Churn) zu verhindern. Es wurde festgestellt, dass automatisierte Reparaturen (z. B. `repair_exam_pool_quality`) oft erfolgreich abgeschlossen werden, ohne den eigentlichen Gate-Blocker (z. B. `integrity_passed = false`) zu beheben.

## Architektur-Guards (P0 implementiert)

### 1. Repair-Eligibility-Matrix (SSOT)
Die DB-Funktion `fn_is_repair_action_eligible(p_package_id, p_repair_action)` prüft zentral, ob eine Reparaturmaßnahme für den aktuellen Blocker überhaupt geeignet ist. `repair_exam_pool_quality` ist nur erlaubt bei exam-pool-spezifischen Blockern (`MISSING_LF_COVERAGE`, `TRAP_COVERAGE_LOW`, `UNRESOLVED_QUALITY_FLAGS`). Bei Publish-/Integrity-Blockern (`AUTO_PUBLISH_GATE_BLOCKED`, `integrity_passed=false`) ohne exam-pool-spezifische Ursache wird der Dispatch blockiert. Zusätzlich supprimiert die Funktion nach ≥2 `blocked_no_effect`-Einträgen in 6h weitere Repairs.

### 2. No-Effect-Reentry-Block
`fn_capture_gate_snapshot` + `fn_has_gate_state_changed` erfassen Vorher/Nachher-Deltas von `integrity_passed`, `quality_gate_passed`, `blocked_reason`, `hard_fail_reasons`, `integrity_report_version`. Wenn der Repair keinen Gate-State verändert hat, wird `result_status='blocked_no_effect'` gesetzt und kein Reentry/Re-Queue von `validate_exam_pool` durchgeführt. Stattdessen wird `blocked_reason='REPAIR_NO_EFFECT_ON_ACTIVE_GATE'` gesetzt.

### 3. Reentry-Schutz in recover_and_reenter_package
Automatisierte Reentry-Aufrufe (nicht `admin_ops`/`manual`) werden blockiert, wenn ≥2 `blocked_no_effect`-Einträge in den letzten 6h vorliegen. Rückgabe: `NO_EFFECT_LOOP_SUPPRESSED`.

### 4. Status-Konsolidierung
`result_status='applied'` wurde systemweit durch `'success'` ersetzt. Guards, die auf `success` filtern, erkennen nun alle positiven Heal-Ergebnisse konsistent. Historische `applied`-Einträge für `recover_and_reenter_package` wurden per Migration konsolidiert.

### Dispatch-Stellen mit Eligibility-Guard
- `heal-dispatch.ts`: Vor Job-Dispatch
- `job-runner/index.ts`: Vor gate_blocked_targeted_repair
- `stuck-scan-hygiene.ts`: Vor stuck-scan-delta-guard Repair
- `package-repair-exam-pool-quality/index.ts`: Am Funktionseinstieg
