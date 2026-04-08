# Memory: architektur/pipeline/qgf-bounce-loop-prevention-and-fingerprinting-v1
Updated: now

Das System verhindert 'QGF-Bounce-Loops' durch drei Schutzschichten:

## 1. Gate Failure Classification (SSOT)
Die zentrale DB-Funktion `fn_classify_gate_failure(hard_fail_reasons[], progress_percent)` klassifiziert Integrity-Failures in zwei Klassen:

**Terminal** (darf `quality_gate_failed` setzen + Auto-Cancel):
- SSOT_VIOLATION, CURRICULUM_MISSING, INTEGRITY_HARD_FAIL, PUBLISH_POSTCONDITION_FAILED, DATA_CORRUPTION, ILLEGAL_STATE, IMMUTABLE_PACKAGE, STRUCTURAL_FAILURE

**Recoverable** (Paket bleibt `building`, keine Job-Cancellation):
- LESSON_QUALITY, EXAM_POOL, COMPETENCY_COVERAGE, MINICHECK, HANDBOOK, ORAL_EXAM, BLOOM, TRAP, ELITE_CONTEXT, LF_COVERAGE, COMPETENCY_STEP_GAP, COMPETENCY_LESSON_GAP

Das Feld `course_packages.gate_class` dokumentiert die Entscheidung (`terminal`, `recoverable`, `healthy`).

## 2. Auto-Cancel-Trigger Härtung
`fn_auto_cancel_jobs_on_package_exit()` prüft `gate_class`:
- Bei `gate_class = 'recoverable'` wird der Übergang `building → quality_gate_failed` **aktiv blockiert** und das Paket bleibt in `building`
- Nur bei terminalen Exits werden Jobs gecancelt
- Alle blockierten Transitionen werden in `system_heal_log` auditiert

## 3. Edge Function Classification
`package-run-integrity-check` klassifiziert `hardFails` gegen eine `TERMINAL_PATTERNS` Whitelist:
- Terminale Patterns → `quality_gate_failed` + `gate_class = 'terminal'`
- Alle anderen → `status = 'building'` + `gate_class = 'recoverable'`
- Progress-aware: Ab >= 70% Progress werden nur terminale Failures als blocking behandelt

## 4. Upstream-Awareness (bestehend)
Vor jeder Klassifizierung prüft der Integrity-Check ob aktive Autofix-Runs oder Remediation-Steps/Jobs existieren. Falls ja, bleibt das Paket unabhängig von der Klassifizierung in `building`.

## 5. Fingerprint-Deduplizierung (bestehend)
Der `pipeline-watchdog` speichert einen Fingerabdruck der `hard_fail_reasons`. Bei identischem Fingerprint im Folgezyklus wird die automatische Heilung ausgesetzt.
