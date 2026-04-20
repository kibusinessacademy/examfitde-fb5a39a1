---
name: Lesson Artifact-Truth Producer-Fix (Bundle→Lesson Materialization Gap)
description: pipeline_write_lesson_content setzt content_hash + generation_status='completed' atomar bei echtem Content. Backfilled 12k Legacy-Lessons.
type: feature
---

# Lesson Artifact-Truth Producer-Fix v1

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

### P0b — Safe-Backfill
12.025 Legacy-Lessons mit echtem Content aber ohne Hash bekommen Hash + completed-Status.
Strenge Guards:
- `is_real_lesson_content` = true (HTML > 400 + total > 200, kein _placeholder)
- `content_hash IS NULL`
- KEIN aktiver `lesson_generate_content` Job für die Lesson
- `courses.autopilot_status != 'sealed'` (sealed Kurse sind final)

### P0c — Versuche zurücksetzen
1.215 blockierte Steps (`generate/validate/finalize_learning_content` in `queued` mit `attempts > 0`) bekommen `attempts=0`, damit Zero-Progress-Guard sie nicht künstlich kappt.

## Architektur-Prinzip
**Producer-first, niemals Verifier-first liberalisieren.** Wenn die Auswertung
"Wahrheit" definiert anders als der Producer, entstehen False-Positives. Die
Realness-Definition (`is_real_lesson_content` mit HTML > 400) bleibt streng;
content_hash ist das Primärsignal für "completed".

## Sealed-Course-Constraint
`guard_sealed_course` Trigger verbietet jede Änderung an Lessons in versiegelten
Kursen, auch durch Pipeline-RPCs. Backfill MUSS sealed Kurse via
`autopilot_status != 'sealed'` ausschließen.

## Schema-Hinweise
- `lessons` hat KEIN `updated_at` (nur `created_at`)
- `lessons.status` Werte: `published`, `placeholder`, `approved`, `active`, `draft`
- `package_steps.status` enum: `queued`, `enqueued`, `running`, `done`, `failed`, `blocked`, `timeout`, `skipped`, `pending_enqueue` (KEIN `pending`)
- `package_steps` hat `last_error`, KEIN `error`

## Files
- DB-Migration 2026-04-20: `pipeline_write_lesson_content` mit 3-Wege-Logik
- DB-Migration 2026-04-20: Backfill UPDATE auf 12k Lessons
- Consumer: `supabase/functions/_shared/lesson-gen/persistence.ts` (unverändert — RPC ist API-kompatibel)
