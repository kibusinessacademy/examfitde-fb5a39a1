# Memory: architektur/ui/admin-step-count-rendering-invariant
Updated: now

Die Anzeige abgeschlossener Schritte ('X/25') im Admin-Dashboard (Control Tower) basiert auf zwei Quellen: 1. `step_status_json` (JSONB-Spalte in `course_packages`) für die Leitstelle und Pipeline-Monitor, ausgewertet via `deriveStepProgress()`. 2. `steps_done` und `steps_functional` (Live-Spalten in `v_admin_packages_ssot`) für die SSOT-View, berechnet aus `package_steps` via `step_agg` CTE. Die `build_progress`-Spalte wird durch den Trigger `fn_sync_package_build_progress` synchronisiert, kann aber bei manuellen SQL-Eingriffen driften. Systemweite Reconciliation erfolgt über: `UPDATE course_packages SET build_progress = ROUND(done::numeric / functional * 100)` basierend auf `package_steps`. Die Formel ist: `steps_done / steps_functional * 100` (skipped Steps werden ausgeschlossen).

## Anti-Drift Guard (seit 2026-03-22)

Ein BEFORE UPDATE Trigger `trg_guard_build_progress_drift` auf `course_packages` fängt JEDE direkte Schreibung von `build_progress` ab und ersetzt den geschriebenen Wert durch den tatsächlich aus `package_steps` berechneten Wert. Dies macht es physisch unmöglich, dass Edge Functions oder manuelle SQL-Eingriffe den `build_progress` vom SSOT-Wert abweichen lassen.

### Entfernte Drift-Quellen (8 Edge Functions bereinigt)
- `build-course-package`: Setzte hardcoded `build_progress: 1` beim Start
- `package-auto-seed-exam-blueprints`: Setzte hardcoded `build_progress: 20`
- `package-generate-exam-pool`: Setzte hardcoded `build_progress: 55` (4 Stellen)
- `package-build-ai-tutor-index`: Setzte hardcoded `build_progress: 80`
- `package-auto-publish`: Setzte hardcoded `build_progress: 100`
- `prebuild-autofix`: Setzte hardcoded `build_progress: 0`
- `admin-ops-actions`: Setzte hardcoded `build_progress: 0`
- `stuck-scan-packages`: Setzte hardcoded `build_progress: 100` (2 Stellen)
