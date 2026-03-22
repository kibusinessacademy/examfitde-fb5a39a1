# Memory: architektur/pipeline/build-progress-calculation-standard-v1-1
Updated: now

Die Berechnung des 'build_progress' in 'course_packages' basiert auf dem Verhältnis der abgeschlossenen funktionalen Schritte (ROUND(steps_done * 100.0 / steps_functional)). Die zentrale Berechnungslogik ist in der RPC `recompute_package_progress(uuid)` gekapselt.

## Anti-Drift Architektur (v2, seit 2026-03-22)

### Dreischichtiger Schutz:
1. **AFTER Trigger auf `package_steps`** (`fn_sync_package_build_progress`): Ruft `recompute_package_progress()` auf bei INSERT, UPDATE OF status, DELETE.
2. **BEFORE Trigger auf `course_packages`** (`fn_guard_build_progress_drift`): Fängt JEDE direkte Schreibung ab, berechnet SSOT-Wert, überschreibt, und **loggt Drift-Versuche** in `package_progress_drift_audit`.
3. **CI-Guard** (`scripts/ci-ssot-guards.sh` Guard 5): Hard-Fail wenn Edge Functions `build_progress` referenzieren.

### Audit-Tabelle: `package_progress_drift_audit`
Loggt abgefangene Fremdschreibungen mit `attempted_value`, `corrected_value`, `operation`. Ermöglicht Post-Mortem-Analyse und Erkennung von Altcode.

### Invariante (DB-enforced):
`course_packages.build_progress` == `ROUND(COUNT(done) * 100.0 / COUNT(non-skipped))` aus `package_steps` — zu jedem Zeitpunkt.
