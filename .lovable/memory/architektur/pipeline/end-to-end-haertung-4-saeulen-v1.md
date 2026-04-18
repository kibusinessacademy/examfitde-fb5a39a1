---
name: End-to-End-Härtung — 4 Säulen (2026-04-18)
description: Strukturelle Härtung gegen Hollow-Drift, Race-Condition und Track-Applicability-Inkonsistenz nach forensischer Analyse von cancelled/failed Job-Mustern.
type: feature
---

# End-to-End-Härtung der Kursgenerierungs-Pipeline (4 Säulen)

## Kontext
Forensische Analyse der `cancelled`/`failed` Jobs der letzten 24h zeigte 3 orthogonale strukturelle Defekte:

1. **D1 — Track-Applicability Mismatch**: 52 EXAM_FIRST(_PLUS) Pakete hatten `generate_learning_content` Steps, obwohl `track_step_applicability.should_run = false`. Resultat: 66 cancelled Jobs/6h mit `ssot_applicability_guard`, Pakete auf `skipped` mit hollow Lessons.
2. **D2 — Trigger-Härtung greift nur bei nicht-`done`-Steps**: Phase B Hollow-Guard hatte `WHERE status IN ('queued','failed','enqueued','running')` — `done`-Steps wurden nicht zurückgezogen. Re-Drift möglich.
3. **D3 — Race-Condition `step_finalized_job_obsoleted`**: 28× cancelled bei `package_generate_exam_pool` über 7 Pakete: Job läuft, Step wird parallel auf `done` gezogen, Job cancelled mit unklarem Grund.
4. **D4 — Materialization-Failures retryen unbegrenzt**: `BLOCKED_BY_MATERIALIZATION exhausted` als retryable klassifiziert → Hot-Loops.

## Die 4 Säulen

### Säule 1 — Track-Applicability korrigiert (DB)
`track_step_applicability.should_run = true` für `generate_learning_content` bei Tracks `EXAM_FIRST` und `EXAM_FIRST_PLUS`. Vorher nur `AUSBILDUNG_VOLL` und `STUDIUM`.

**Wirkung**: 52 EXAM_FIRST Pakete dürfen jetzt offiziell Lerninhalte generieren. Der `ssot_applicability_guard` cancelt diese Jobs nicht mehr.

### Säule 2 — Trigger-Guard zieht auch `done` zurück (DB)
`fn_trigger_sync_step_on_job_complete` erweitert: Bei Hollow-Detection (placeholders > 0, ratio < 0.90, etc.) wird die `WHERE`-Klausel auf `('queued','failed','enqueued','running','done','skipped')` ausgeweitet. Zusätzlich `meta.allow_regression=true` + `allow_regression_by='hollow_guard_done_revoke'` gesetzt.

**Wirkung**: Re-Drift `done → hollow → done` wird strukturell unmöglich. Auch nach Phase B kann ein bereits gedrifteter Step zurückgezogen werden.

### Säule 3 — Race-Condition Guard (DB)
Neuer BEFORE-Trigger `trg_guard_obsolete_processing_jobs` auf `job_queue`. Wenn ein Job nach `processing` transitioniert und der zugehörige Step bereits `done`/`skipped` ist, wird der Job direkt im Trigger sauber als `cancelled` mit `last_error_kind='preempted_by_step_state'` markiert — kein Race mehr, klare Telemetrie.

**Wirkung**: `step_finalized_job_obsoleted` wird zu `preempted_by_step_state` mit eindeutiger Klassifikation. Kein verschwendeter Edge-Function-Aufruf.

### Säule 4 — Materialization-Failures = permanent (Edge)
`_shared/pg-error.ts` `classifyDbError` erweitert: Error-Messages mit `BLOCKED_BY_MATERIALIZATION ... exhausted`, `PLACEHOLDER_LESSONS_PRESENT`, `HOLLOW_LEARNING_CONTENT`, `LESSON_SUBSTANCE_BELOW_THRESHOLD`, `THRESHOLD_FAIL ... exhausted` werden als `permanent` klassifiziert.

**Wirkung**: Kein Retry-Loop mehr. Jobs failen sauber nach erstem exhausted-Marker, statt 3-8x zu retryen und in Hot-Loop-Quarantäne zu landen.

## Phase A v3 — Heilung der 18 betroffenen Pakete
Nach Säule 1 wurden alle Steps `generate_learning_content`, `fanout_learning_content`, `finalize_learning_content`, `validate_learning_content` mit Status `skipped` für EXAM_FIRST(_PLUS) Pakete zurück auf `queued` gesetzt. Cancel-Sweep der pending/failed Jobs.

## Files
- DB-Migration vom 2026-04-18: track_step_applicability UPDATE + fn_trigger_sync_step_on_job_complete + fn_guard_obsolete_processing_jobs
- `supabase/functions/_shared/pg-error.ts` (Säule 4)
- Deployed: `lesson-generate-content`, `package-generate-learning-content`, `package-validate-exam-pool`, `package-generate-exam-pool`

## Reason Codes (vereinheitlicht)
- `preempted_by_step_state` (Säule 3)
- `hollow_guard_done_revoke` (Säule 2)
- `materialization_guard_exhausted` (Säule 4)
- `ssot_applicability_guard` (jetzt korrekt nur bei wirklich nicht-anwendbaren Steps)
