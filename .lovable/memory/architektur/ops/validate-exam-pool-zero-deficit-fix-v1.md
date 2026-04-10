# Fix: validate_exam_pool Zero-Deficit Endlos-Loop

## Umgesetzt: 2026-04-10

### Root Cause
`fn_classify_validate_guard` (Pre-Gate) verglich nur Snapshot-Deltas zwischen aufeinanderfolgenden Validierungen. Wenn ein Package alle Kriterien bereits erfüllte (missing_lf=0, missing_comp=0, missing_trap=0), waren die Deltas 0 → "kein Fortschritt" → endloser Requeue-Zyklus als `REPAIR_RUNNING_AWAITING_DELTA`.

Die eigentliche Gate-Funktion `fn_classify_exam_pool_gate` gab korrekt `PASS` zurück, wurde aber vom Guard nie gefragt.

### Betroffene Pakete (vor Fix)
- Spedition: 471 wirkungslose Zyklen
- Bankkaufmann: 447
- Bilanzbuchhalter: 326
- Mechatroniker: 188
- FI – Anwendungsentwicklung: 140
- FI – Digitale Vernetzung: 133
- Wirtschaftsinformatik: 61

### Fix
1. `fn_classify_validate_guard` ruft jetzt **zuerst** `fn_classify_exam_pool_gate` auf
2. Bei `gate_status = 'PASS'` → sofort `guard_state = 'pass_ready'` mit `action = 'mark_step_done'`
3. Bei `gate_status = 'HARD_FAIL'` → sofort `guard_state = 'hard_stalled'` mit `action = 'block'`
4. Circuit-Breaker: Nach 10 consecutive no-progress Zyklen ohne aktive Jobs → `hard_stalled` statt endlosem Requeue

### Design-Prinzip
> "Der Guard darf nie schlauer sein wollen als das Gate. Wenn das Gate PASS sagt, ist der Guard fertig."
