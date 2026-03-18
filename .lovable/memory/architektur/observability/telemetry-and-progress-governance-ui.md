# Memory: architektur/observability/telemetry-and-progress-governance-ui
Updated: now

Das 'Telemetry & Progress Governance' System bietet Echtzeit-Visibilität und automatisierte Fehlerbehebung für Pipeline-Inkonsistenzen über vier Schichten:

**1. View `ops_telemetry_integrity`**: Überwacht 'Logging-Gaps' (Content ohne Kostenerfassung) und 'Progress-Drift' (stored vs. real artifact progress) für alle building-Pakete.

**2. View `ops_telemetry_lineage`**: Identifiziert den konkreten Producer pro Paket, der Content ohne LLM-Kosten-Events erzeugt. Klassifiziert Coverage als BLIND/PARTIAL/COVERED/INACTIVE. **Befund**: Der `batch-result-importer` ist der primäre blinde Producer — er schreibt `content_versions` ohne korrespondierende `llm_cost_events`.

**3. Trigger `trg_enforce_artifact_progress`**: Governance-Trigger auf `course_packages`, der alle Schreibzugriffe auf `build_progress` abfängt und durch die artefaktbasierte SSOT (`ops_artifact_build_progress.real_progress`) ersetzt. Ausnahmen: Status-Transitionen (draft/queued→0, published→100, initial building→1). Jeder Override wird in `auto_heal_log` protokolliert. **Inventar gehärteter Schreiber**: 9+ Edge Functions schrieben zuvor hardcodierte Werte (1, 20, 55, 80, 100) — der Trigger zentralisiert diese jetzt auf SSOT.

**4. UI-Komponenten**: `TelemetryIntegrityCard` und `ProgressDriftCard` im Control Tower visualisieren Abweichungen und bieten One-Click Recovery-Actions (reconcile_progress, clear_guards, repair_finalize).

**5. Alerts**: `check_telemetry_gap_alerts()` identifiziert systematische Logging-Ausfälle und eskaliert als `ops_alert_events`.
