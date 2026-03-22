# Memory: architektur/pipeline/build-progress-calculation-standard-v1-1
Updated: now

Die Berechnung des 'build_progress' in 'course_packages' basiert auf dem Verhältnis der abgeschlossenen funktionalen Schritte zum 25-Schritte-Backbone (ROUND(steps_done * 100.0 / steps_functional)). Um Drift durch manuelle Eingriffe zu eliminieren, bietet die View 'v_admin_packages_ssot' die Spalten 'steps_done' und 'steps_functional' als Live-Zählung direkt aus der 'package_steps' Tabelle an. Das Admin-Dashboard nutzt diese Live-Werte für die 'X/25' Anzeige, um Diskrepanzen zwischen Fortschrittsbalken und realer Step-Wahrheit auszuschließen.

## Anti-Drift Architektur (seit 2026-03-22)

### Zweischichtiger Schutz:
1. **AFTER UPDATE Trigger** (`fn_sync_package_build_progress`): Berechnet `build_progress` neu wenn sich der Status eines `package_steps` Eintrags ändert.
2. **BEFORE UPDATE Trigger** (`fn_guard_build_progress_drift`): Fängt JEDE direkte Schreibung auf `course_packages.build_progress` ab und ersetzt den Wert durch den SSOT-berechneten Wert aus `package_steps`. Dies macht Drift durch Edge Functions oder SQL physisch unmöglich.

### Invariante:
`course_packages.build_progress` == `ROUND(COUNT(done) * 100.0 / COUNT(non-skipped))` aus `package_steps` — zu jedem Zeitpunkt, enforced durch DB-Trigger.
