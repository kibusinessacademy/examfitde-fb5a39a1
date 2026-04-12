# Publish-Recovery-Loop v1

## Umgesetzt: 2026-04-12

### Problem
`auto_publish` scheiterte an `LESSON_QC_GATE_FAILED` (draft Lessons mit tier1_failed/needs_revision),
setzte aber den generischen Status `quality_gate_failed` — semantisch verwirrend, da Integrity + Council bestanden waren.
Kein automatischer Repair-Pfad existierte.

### Lösung: 4-Phasen-Architektur

#### 1. Status-Trennung
- Neuer Status `publish_failed` für Lesson-QC-spezifische Publish-Blockaden
- `quality_gate_failed` bleibt für echte Quality-Gate-Failures (Integrity, Council)
- Guards erweitert: `guard_package_leases_building_only`, `trg_reconcile_stale_quality_gate_failed`, `fn_reap_non_building_pending_jobs`

#### 2. Auto-Publish Update
- Bei `LESSON_QC_GATE_FAILED`: Status → `publish_failed` (nicht mehr `quality_gate_failed`)
- Failed-Lesson-IDs + Retry-Count in Package-Meta gespeichert
- Automatischer Enqueue von `package_repair_failed_lessons` (max 2 Retries)

#### 3. Neue Edge Function: `package-repair-failed-lessons`
- Identifiziert failed Lessons (draft + tier1_failed/needs_revision)
- Klassifiziert Repair-Modus pro Lesson: full_regenerate / expand_depth / fix_structure
- Resettet `qc_status` → pending, markiert Placeholders für Regeneration
- Setzt Package → building, re-queued `generate_learning_content` + downstream Steps
- Circuit-Breaker: max 2 Repair-Runden

#### 4. Lane-SSOT + Job-Map
- `package_repair_failed_lessons` in Recovery Lane eingetragen
- JOB_DEFINITIONS in `job-map.ts` ergänzt
- `job_type_policies`: `can_run_when_not_building = true`

### Invarianten
- Repair-Job darf max 2× pro Paket laufen → danach manuelle Eskalation
- Reaper schützt `publish_failed` Pakete vor Job-Stornierung
- Reconciler kann `publish_failed` → `published` promoten wenn alle Lessons clean
