---
name: Lesson Artifact-Truth Producer-Fix + Causality + Lifecycle + Postcondition-Alignment v1.3
description: pipeline_write_lesson_content setzt content_hash + generation_status='completed' atomar. Backfill v1+v2 für 13.5k Lessons. Causality-Guard verhindert HARD_FAIL_NO_BLUEPRINTS. validate-learning-content finalisiert ALLE early-return Pfade. HOLLOW_VALIDATE_LEARNING Postcondition: Phantom-Filter `lesson_type` (Spalte existiert nicht) entfernt, content_hash + generation_status='completed' jetzt Primärsignale.
type: feature
---

# Lesson Artifact-Truth + Causality Governance v1.1

## Incident
2026-04-20: 8 `package_generate_learning_content` Jobs steckten 12.7h fest.
Zero Completions in 24h. DB hatte 48.906 Lessons mit content, aber **alle ohne
`content_hash`** und `generation_status` nie auf `completed`. Hollow-Guards in
`fn_trigger_sync_step_on_job_complete` blockierten downstream-Steps trotz
inhaltlich fertiger Lessons.

## Root Cause (Producer-Lücke)
`pipeline_write_lesson_content` schrieb nur `content`, nie `content_hash` oder
`generation_status`. `lesson-generate-content` (process-lesson.ts → persistence.ts)
ruft diesen RPC nach erfolgreicher Generierung auf — die Artefakt-Wahrheit fehlte
am Producer-Output.

## Fix-Reihenfolge (producer-first, nicht verifier-first)

### P0a — Producer-Fix
`pipeline_write_lesson_content(uuid, jsonb)` jetzt 3-Wege-Logik:
1. **Placeholder** (`_placeholder=true` oder `_regenerating=true`): nur content + status='placeholder'
2. **Real** (`is_real_lesson_content` = true): content + `content_hash = md5(content::text)` + `generation_status = 'completed'` + status='approved' (oder höher)
3. **Grey-Zone** (content vorhanden aber nicht publish-quality): nur content, kein completed

### P0b — Backfill v1 (HTML-Längen-Filter)
12.025 Legacy-Lessons mit echtem Content + HTML > 400 chars bekamen Hash + completed-Status.

### P0.5 — Backfill Sweep v2 (SSOT only)
**1.482 weitere Lessons** ohne HTML-Längen-Gate, nur `is_real_lesson_content(content) = true`.
Insgesamt jetzt **13.507 Lessons mit content_hash + generation_status='completed'**.
Verbleibender true_gap = 1.048, **alle in sealed Kursen** (per Design ausgeschlossen).

Strenge Guards (v1 + v2):
- `is_real_lesson_content` = true
- `content_hash IS NULL`
- KEIN aktiver `lesson_generate_content` Job für die Lesson
- `courses.autopilot_status != 'sealed'` (sealed Kurse sind final)

## P1 — Causality-Guard für validate_exam_pool

`fn_guard_validate_exam_pool_causality` (BEFORE INSERT/UPDATE auf `job_queue`):
Cancelled `package_validate_exam_pool` Jobs sofort mit Reason
`UPSTREAM_CAUSALITY_NOT_SATISFIED_BLUEPRINTS`, wenn:
- `auto_seed_exam_blueprints` Step nicht in (`done`, `skipped`)
- ODER `question_blueprints` count = 0 für die Curriculum
- ODER `validate_blueprints` Step nicht in (`done`, `skipped`)

Audit: `admin_actions.action = 'validate_exam_pool_causality_guard_blocked'`
mit `missing_upstream` Detail.

**Effekt:** Statt `HARD_FAIL_NO_BLUEPRINTS` Fehlerlärm jetzt saubere DAG-konforme
Cancels mit explizitem Reason. Geschwistermuster zu `fn_guard_generate_exam_pool_causality`.

## Architektur-Prinzip
**Producer-first, niemals Verifier-first liberalisieren.** Wenn die Auswertung
"Wahrheit" definiert anders als der Producer, entstehen False-Positives. Die
Realness-Definition (`is_real_lesson_content`) bleibt SSOT; content_hash ist das
Primärsignal für "completed". Backfill v2 nutzt **ausschließlich** SSOT, kein
sekundäres HTML-Längen-Gate.

## Sealed-Course-Constraint
`guard_sealed_course` Trigger verbietet jede Änderung an Lessons in versiegelten
Kursen, auch durch Pipeline-RPCs. Backfill MUSS sealed Kurse via
`autopilot_status != 'sealed'` ausschließen.

## Schema-Hinweise
- `lessons` hat KEIN `updated_at` (nur `created_at`)
- `lessons.status` Werte: `published`, `placeholder`, `approved`, `active`, `draft`
- `lessons.generation_status` ist `text`, gültige Werte u.a.: `pending`, `processing`, `generated`, `completed`, `failed`
- `package_steps.status` enum: `queued`, `enqueued`, `running`, `done`, `failed`, `blocked`, `timeout`, `skipped`, `pending_enqueue` (KEIN `pending`)
- `package_steps` hat `last_error`, KEIN `error`
- `job_queue.last_error` (text, frei) für Cancel-Reasons

## P2 — Validator Lifecycle Finalisierung (kein Stale-Lock-Loop)

`package-validate-learning-content` hatte 3 early-return Pfade ohne SSOT-Finalisierung,
was zu `STALE_LOCK_LOOP_HARD_KILL` führte (Job blieb in `processing`, Step nie terminiert).

Patch v2.2: Jeder terminale Branch ruft jetzt explizit `finalizeStepDone` oder `finalizeStepFailed`:

| Branch | Finalisierung | Reason |
|---|---|---|
| `WAITING_FOR_MATERIALIZATION` (pending lessons > 0) | `finalizeStepDone` (transient skip) | `WAITING_FOR_MATERIALIZATION` |
| `SKIP_RETRY` (repair in flight) | `finalizeStepDone` (transient skip) | `SKIP_RETRY_REPAIR_IN_FLIGHT` |
| `ALL_LESSONS_ARE_PLACEHOLDERS` (totalLessons > 0) | `finalizeStepDone` (transient skip) | `ALL_LESSONS_ARE_PLACEHOLDERS` |
| `0 total lessons` (echter Defekt) | `finalizeStepFailed` (permanent) | `NO_MATERIALIZED_CONTENT` |

Standardisierte Finalisierungs-Meta in `package_steps.meta` für Forensik:
- `decision_type`: `transient_skip` | `permanent_fail`
- `decision_reason`: kanonischer Reason-Code
- `repair_in_flight`, `materialized_lessons_count`, `total_lessons` (kontextabhängig)

**Regel:** Vor jedem `return json(...)` in einem terminalen Branch MUSS genau eines passieren:
`finalizeStepDone(...)` ODER `finalizeStepFailed(...)`. Kein früher Return ohne Finalisierung.
Top-level `try/catch` in `Deno.serve` bleibt als Fangnetz für Runtime-Exceptions.

## P0a — Postcondition-Alignment (HOLLOW_VALIDATE_LEARNING)

`assertExtendedPostConditions("validate_learning_content")` hatte zwei Defekte:

**Defekt A — Phantom-Filter:** `.neq("lesson_type", "mini_check")` referenzierte eine
nicht existierende Spalte. Die echte Spalte heißt `step` (USER-DEFINED enum).
PostgREST lieferte daher einen Fehler oder unerwartetes Verhalten.

**Defekt B — Producer-Truth ignoriert:** Die Postcondition prüfte nur `COUNT(lessons)`
und kannte weder `content_hash` noch `generation_status='completed'`. Forensik zeigte
15 Pakete mit avg **102 Lessons mit content_hash + completed**, die trotzdem als
HOLLOW abgelehnt wurden.

**Fix:** Postcondition akzeptiert jetzt vorrangig den SSOT-Materialisierungsstatus:
- `realCount = max(content_hash IS NOT NULL, generation_status='completed')`
- Wenn `realCount >= minLessons` → pass
- Sonst Fallback auf totalLessons (ohne Phantom-Filter)
- Bei totalLessons > 0 ohne Materialisierung → transient pass (Validator-Logik handhabt WAITING_FOR_MATERIALIZATION)

## Files
- DB-Migration 2026-04-20 #1: `pipeline_write_lesson_content` 3-Wege-Logik + Backfill v1 (12k)
- DB-Migration 2026-04-20 #2: Backfill Sweep v2 (1.482 Lessons, SSOT-only)
- DB-Migration 2026-04-20 #3: `fn_guard_validate_exam_pool_causality` + Trigger
- Edge Function 2026-04-20 #4: `package-validate-learning-content` early-return finalization (P2)
- Edge Function 2026-04-20 #5: `_shared/post-conditions-extended.ts` validate_learning_content alignment (P0a)

## Sister Pattern
Siehe `architektur/ops/causality-drift-governance-v1.md` für analogen Guard
`fn_guard_generate_exam_pool_causality` (gleiche Schutzschicht, anderer Job-Typ).
