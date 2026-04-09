# Synchronous Step Finalization Governance v1

## Kontext
Pipeline-Stillstand durch asynchronen Drift: `job_queue` zeigt `completed`, aber `package_steps` bleibt `queued`. Root Cause: `fn_sync_steps_from_completed_jobs` hatte unvollständige Job-Type-Mappings und falsche Ausschlüsse.

## Dauermaßnahmen (umgesetzt 2026-04-09)

### 1. Synchroner Trigger `trg_sync_step_on_job_complete`
- Feuert bei jedem `job_queue` Status-Update auf `completed` mit `ok: true`
- Setzt den zugehörigen `package_steps`-Eintrag sofort auf `done`
- Eliminiert die Abhängigkeit vom asynchronen Healer

### 2. Vollständige Job-Type → Step-Key Mapping
Beide Stellen (Trigger + Healer-Funktion) nutzen identische Map mit 27 Einträgen.
Zuvor fehlten: `package_run_integrity_check`, `package_validate_exam_pool`, `package_promote_blueprint_variants`, `package_generate_learning_content`, `package_scaffold_learning_course`.

### 3. Korrigierte Ausschlussliste
Nur noch `repair_exam_pool_quality` ist ausgeschlossen (echter Cycling-Step).
`run_integrity_check` und `validate_exam_pool` sind NICHT mehr ausgeschlossen – sie synchen zu `done` und werden nur bei Datenänderungen via Staleness-Trigger zurückgesetzt.

## Invarianten
- Jeder neue Job-Type MUSS in beiden Maps (Trigger + Healer) ergänzt werden
- Die Ausschlussliste darf NUR echte Repair-/Cycling-Steps enthalten
- Der Trigger ist SECURITY DEFINER und läuft auf `job_queue`
