# Memory: architektur/ui/admin-step-count-rendering-invariant
Updated: now

Die Anzeige abgeschlossener Schritte ('X/25') im Admin-Dashboard (Control Tower) basiert auf zwei Quellen: 1. `step_status_json` (JSONB-Spalte in `course_packages`) für die Leitstelle und Pipeline-Monitor, ausgewertet via `deriveStepProgress()`. 2. `steps_done` und `steps_functional` (Live-Spalten in `v_admin_packages_ssot`) für die SSOT-View, berechnet aus `package_steps` via `step_agg` CTE. Die `build_progress`-Spalte wird durch den Trigger `fn_sync_package_build_progress` synchronisiert, kann aber bei manuellen SQL-Eingriffen driften. Systemweite Reconciliation erfolgt über: `UPDATE course_packages SET build_progress = ROUND(done::numeric / functional * 100)` basierend auf `package_steps`. Die Formel ist: `steps_done / steps_functional * 100` (skipped Steps werden ausgeschlossen).

## Anti-Drift Architektur v2 (seit 2026-03-22)

### Dreischichtiger Schutz:
1. **AFTER Trigger auf `package_steps`** (`fn_sync_package_build_progress`): Ruft `recompute_package_progress()` auf bei INSERT, UPDATE OF status, DELETE.
2. **BEFORE Trigger auf `course_packages`** (`fn_guard_build_progress_drift`): Fängt JEDE direkte Schreibung ab, berechnet SSOT-Wert, überschreibt, und **loggt Drift-Versuche** in `package_progress_drift_audit`.
3. **CI-Guard** (`scripts/ci-ssot-guards.sh` Guard 5): Hard-Fail wenn Edge Functions `build_progress` schreiben.

### Entfernte Drift-Quellen (14 Edge Functions / Shared Modules bereinigt)
- `build-course-package`, `package-auto-seed-exam-blueprints`, `package-generate-exam-pool` (4×), `package-build-ai-tutor-index`, `package-auto-publish`, `prebuild-autofix`, `admin-ops-actions`, `stuck-scan-packages` (2×), `pipeline-process`, `package-run-integrity-check`, `admin-ops` (2×), `admin-seed-production-wave`, `production-guardian`, `qualification-auto-wave`

### Audit-Tabelle: `package_progress_drift_audit`
Loggt abgefangene Fremdschreibungen mit `attempted_value`, `corrected_value`, `operation`.
