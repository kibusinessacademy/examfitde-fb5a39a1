# Infrastructure Safety & Repair Governance

## Updated: 2026-04-11

### Zombie-Recovery: Smart Classification (fn_smart_zombie_recovery)
- **POISON_LOOP** (attempts ≥ 5): → `failed` (terminiert)
- **STALE_LOCK_RECURRENT** (attempts ≥ 3 + STALE_LOCK error): → `failed` (terminiert)
- **HARD_ZOMBIE** (lock > 600s): → `pending` (reset)
- **SOFT_ZOMBIE** (lock > 300s): → `pending` (reset)
- Kein pauschaler 5-Min-Cutoff mehr — Klassifikation nach Attempts, Fehlerhistorie und Lock-Alter.

### Legacy-Step-Guard (trg_guard_canonical_step_keys)
- Trigger auf `package_steps` BEFORE INSERT
- Blockiert jede Einfügung nicht-kanonischer Step-Keys (29-Step SSOT)
- Verhindert Reinfektion durch alte Trigger, Healer oder Reconciler

### SSOT-Funktion: fn_expected_steps_for_track(track)
- Zentrale Quelle für erlaubte Steps pro Track
- Track-aware: Lernkurs-Kette wird für EXAM_FIRST/EXAM_FIRST_PLUS übersprungen
- Oral Exam nur für AUSBILDUNG_VOLL + EXAM_FIRST_PLUS
- AI Tutor, MiniChecks, Handbook Expand nur für AUSBILDUNG_VOLL
- Elite Harden nur für AUSBILDUNG_VOLL + EXAM_FIRST_PLUS

### Audit-View: ops_step_ssot_drift
- Zeigt MISSING_STEP, SHOULD_BE_SKIPPED, WRONGLY_SKIPPED Anomalien
- Scoped auf building/blocked/quality_gate_failed/ready Pakete
- Primäres Monitoring-Instrument für Step-Konsistenz

### Fail-Klassifikation: ops_validate_exam_pool_fail_classification
- Segmentiert validate_exam_pool Fails nach Root Cause
- Klassen: NO_BLUEPRINTS, NO_CURRICULUM, GENERATION_NEVER_RAN, REPAIR_EXHAUSTED, LF_COVERAGE_GAP, OTHER
- Zeigt exam_q_count und blueprint_count pro Paket

### WIP & Concurrency Governance
- WIP_TOTAL_CAP = 8, WIP_EFFECTIVE_MAX = 12
- content_runner: maxConcurrency 6, claimLimit 8 (Hard Cap 8/12)
- job_runner: maxConcurrency 4, claimLimit 6 (Hard Cap 10/10)
- Poison-Loop Guard bei ≥ 3 identischen Fehlern blockiert Requeues
