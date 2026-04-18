---
name: HOLLOW_LEARNING_CONTENT Guard (Verifier + DB-Trigger)
description: Drei-Schichten-Schutz gegen den Re-Drift-Loop, der generate_learning_content trotz hollow Lessons als done synchronisierte.
type: feature
---

# HOLLOW_LEARNING_CONTENT Guard

## Incident
2026-04-18: Paket `3f416f2f` zeigte `generate_learning_content = done`, obwohl
247/300 Lessons placeholder waren (substantive_ratio 0.18). Jeder manuelle
Reset wurde innerhalb von 3 Min vom DB-Trigger `trg_sync_step_on_job_complete`
wieder auf `done` gezogen, sobald der nächste `package_generate_learning_content`
Job mit `result.ok = true` abschloss.

Root Cause: drei Lücken gleichzeitig
1. `artifact-verifier.ts` hatte **keinen** Verifier für `package_generate_learning_content` → fiel auf `{ok:true}` durch.
2. `_shared/preflight-registry.ts` hatte **keinen** Eintrag für `generate_learning_content`.
3. `fn_trigger_sync_step_on_job_complete` setzte blind `status='done'` mit `meta.postcondition_verified=true` als Lüge — ohne SSOT-Lesson-Substanz zu prüfen.

## Drei-Schichten-Schutz (alle fail-closed)

### 1. Edge: artifact-verifier.ts — package_generate_learning_content
Reasons: `HOLLOW_LEARNING_CONTENT:no_lessons`, `PLACEHOLDER_LESSONS_PRESENT:n/total`,
`LESSON_SUBSTANCE_BELOW_THRESHOLD:r/total@ratio<0.90`, `LESSON_GENERATION_INCOMPLETE:n_jobs_active`,
`THRESHOLD_FAIL:learning_content:avg_len:n/600`.

### 2. Edge: preflight-registry.ts — generate_learning_content
Pre-Flight für markStepDone. Identische Schwellen wie der Verifier.

### 3. DB: fn_trigger_sync_step_on_job_complete
Hollow-Guard direkt im Sync-Trigger:
- `package_lessons_realness(package_id)` liefert SSOT-Zahlen
- block wenn placeholders > 0, substantive_ratio < 0.90, pending lesson_generate_content > 0, oder avg_len < 600
- bei block: Step bleibt/geht auf `queued` mit `last_error` und `meta.hollow_guard_*` für Forensik
- nur bei sauberer SSOT wird `done` synchronisiert

## Schwellen (SSOT)
- substantive_ratio ≥ 0.90
- placeholder_count = 0
- pending_generation_lessons = 0
- avg_lesson_length ≥ 600 chars

## Reason Codes (vereinheitlicht)
- `HOLLOW_LEARNING_CONTENT`
- `LESSON_SUBSTANCE_BELOW_THRESHOLD`
- `PLACEHOLDER_LESSONS_PRESENT`
- `LESSON_GENERATION_INCOMPLETE`

## Files
- `supabase/functions/_shared/artifact-verifier.ts` (Verifier-Eintrag)
- `supabase/functions/_shared/preflight-registry.ts` (Preflight-Eintrag)
- DB-Migration vom 2026-04-18: `fn_trigger_sync_step_on_job_complete` hardened
- DB-Tabelle `ops_job_type_registry`: + `regenerate_learning_content_cluster`, `repair_learning_content`, `lesson_generate_competency_bundle`, `package_repair_failed_lessons`
