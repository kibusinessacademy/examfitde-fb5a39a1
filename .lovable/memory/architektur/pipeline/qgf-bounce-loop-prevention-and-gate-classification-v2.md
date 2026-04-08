# Memory: architektur/pipeline/qgf-bounce-loop-prevention-and-gate-classification-v2
Updated: now

Das System verhindert 'QGF-Bounce-Loops' (endloses Scheitern und Wiederherstellen von Quality Gates) durch ein strukturelles Klassifizierungsmodell in 'fn_classify_gate_failure'. Fehler werden in zwei Kategorien unterteilt: 1. Recoverable (z. B. LESSON_QUALITY, EXAM_POOL, COMPETENCY_COVERAGE): Diese halten das Paket im Status 'building', um eine Heilung durch Upstream-Jobs zu ermöglichen, und verhindern den automatischen Job-Abbruch (AUTO_CANCEL). 2. Terminal (z. B. SSOT_VIOLATION, DATA_CORRUPTION): Diese führen zum sofortigen Wechsel in 'quality_gate_failed'. Ein 'Progress-aware Guard' schützt Pakete ab einem Fortschritt von >= 70 % vor terminalen Status-Wechseln bei rein inhaltlichen Defiziten. Zur Auditierung und Steuerung wird das Feld 'gate_class' in 'course_packages' genutzt. Ergänzend speichert der 'pipeline-watchdog' einen Fingerabdruck der Fehlergründe, um bei identischen Resultaten ohne Fortschritt die automatische Heilung auszusetzen.

## SSOT-Architektur (v2.1 - gehärtet)

### Einzige Klassifizierungsquelle: DB-Funktion
Die Edge Function `package-run-integrity-check` enthält **keine eigene TERMINAL_PATTERNS-Liste** mehr. Stattdessen ruft sie die DB-SSOT-Funktion `fn_classify_gate_failure(p_hard_fail_reasons, p_progress_percent)` via RPC auf und wendet nur deren Ergebnis (gate_class, recommended_status) an. Dies eliminiert die TS↔DB-Drift-Gefahr vollständig.

### Trigger als Fail-Safe Guard
Der `fn_auto_cancel_jobs_on_package_exit` Trigger blockiert Übergänge von `building` → `quality_gate_failed` aktiv, wenn `gate_class = 'recoverable'`. Er dient als Sicherheitsnetz, nicht als Primärlogik — die Edge Function selbst setzt den Status korrekt.

### Auto-Cancel Kopplung
Job-Cancellation erfolgt ausschließlich bei `gate_class = 'terminal'`. Recoverable Gate Failures lösen keine Job-Abbrüche aus.
