---
name: Lesson Artifact-Truth Producer-Fix + Causality Governance + Validator Lifecycle v1.2
description: pipeline_write_lesson_content setzt content_hash + generation_status='completed' atomar bei echtem Content. Backfill v1+v2 für 13.5k Lessons. Causality-Guard verhindert HARD_FAIL_NO_BLUEPRINTS. package-validate-learning-content finalisiert ALLE early-return Pfade via SSOT (kein Stale-Lock-Loop).
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

## Files
- DB-Migration 2026-04-20 #1: `pipeline_write_lesson_content` 3-Wege-Logik + Backfill v1 (12k)
- DB-Migration 2026-04-20 #2: Backfill Sweep v2 (1.482 Lessons, SSOT-only)
- DB-Migration 2026-04-20 #3: `fn_guard_validate_exam_pool_causality` + Trigger
- Consumer: `supabase/functions/_shared/lesson-gen/persistence.ts` (unverändert — RPC ist API-kompatibel)

## Sister Pattern
Siehe `architektur/ops/causality-drift-governance-v1.md` für analogen Guard
`fn_guard_generate_exam_pool_causality` (gleiche Schutzschicht, anderer Job-Typ).
