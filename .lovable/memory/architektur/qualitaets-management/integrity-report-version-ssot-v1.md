# Memory: architektur/qualitaets-management/integrity-report-version-ssot-v1
Updated: 2026-03-29

Die aktuelle Integrity-Report-Version wird zentral als DB-Funktion `current_integrity_report_version_num()` (IMMUTABLE) gespeichert — aktuell: **16** (COURSE_READY_v1.6). Diese Funktion ist die SSOT für alle Stellen, die Reportversionen prüfen:

1. **`mark_legacy_integrity_reports()`** — nutzt jetzt `current_integrity_report_version_num()` statt Text-Pattern-Matching
2. **`enqueue_integrity_rechecks()`** — prüft `integrity_report_version_num < current_version` statt `LIKE '%/500%'`
3. **`legacy-reconcile` Edge Function** — `CURRENT_REPORT_VERSION_NUM = 16` (manuell synchron halten)
4. **`package-run-integrity-check` Edge Function** — schreibt `version_num: 16`

## Systemischer Schutz

Der Trigger `trg_block_publish_on_stale_integrity` auf `package_steps` blockiert physisch jeden `auto_publish`-Übergang zu `running`, wenn das Paket einen veralteten Report hat (`version_num < current`). Dabei wird:
- `integrity_passed` auf `false` gesetzt
- `run_integrity_check` automatisch auf `queued` zurückgesetzt
- `auto_publish` auf `queued` zurückgehalten mit Fehlergrund

## Wartungsregel

Bei jeder neuen Report-Version: `ALTER FUNCTION current_integrity_report_version_num() ... AS $$ SELECT <neue_version> $$;` — eine Migration, alle Consumers aktualisiert. Edge Functions müssen manuell synchronisiert werden.
