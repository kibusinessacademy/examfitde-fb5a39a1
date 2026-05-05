---
name: Course Publish Readiness Guard v1
description: BEFORE-Trigger auf public.courses blockt status→published wenn curriculum_id, modules oder lessons fehlen. Bypass nur via session GUC app.transition_source='admin_force_publish'. Jeder Block + Bypass im auto_heal_log.
type: feature
---

## Ziel
Verhindert, dass neue Empty-/Phantom-Courses je wieder published werden. Komplementär zu Empty-Courses-Ratchet (heilt Bestand).

## Mechanik
- Trigger `trg_guard_course_publish_readiness` BEFORE INSERT OR UPDATE OF status ON public.courses
- Funktion `fn_guard_course_publish_readiness()` (SECURITY DEFINER, search_path=public)
- Pflicht beim Wechsel auf `published`:
  - `curriculum_id IS NOT NULL`
  - ≥1 row in `modules WHERE course_id=NEW.id`
  - ≥1 row in `lessons l JOIN modules m ON m.id=l.module_id WHERE m.course_id=NEW.id`
- Block: `RAISE EXCEPTION 'COURSE_PUBLISH_READINESS_BLOCKED'` (ERRCODE check_violation)
- Bypass: `SELECT set_config('app.transition_source','admin_force_publish',true);` in derselben Transaktion

## Audit-Contract (auto_heal_log)
- Block: `action_type='course_publish_readiness_blocked'`, `result_status='blocked'`, `target_type='course'`, `target_id=course.id`, `metadata={modules,lessons,curriculum_id,missing[],source}`
- Bypass: `action_type='course_publish_readiness_bypassed'`, `result_status='bypassed'` (gleiche metadata)

## Nicht betroffen
- Bereits published Kurse (UPDATE OLD.status='published' → return)
- Andere Statuswechsel (draft, archived, etc.)

## Backfill-Pipeline-Trigger
`admin_backfill_course_skeleton` enqueued nach Modul/Lesson-Anlage automatisch:
- `lesson_generate_content` pro Placeholder-Lesson
- `package_generate_lesson_minichecks` pro resolved package_id
- `council_recompute_course_ready` pro Kurs

→ Skeletons werden lernbar, nicht nur sichtbar. `jobs_enqueued` im Result + Heal-Log-Metadata.

## CI-Tests
- `scripts/guards/course-publish-guard-test.mjs` (Node, service-role): empty→blocked + auto_heal_log + bypass via `admin_force_publish_course_for_test` RPC.
- `tests/e2e/course-publish-guard.spec.ts` (Playwright, REST): app-Workflow (PATCH courses) für empty-rejected + valid-accepted.
- Workflow `.github/workflows/course-publish-guard.yml` (PR + nightly 04:37 UTC).

## Cockpit
- Route `/admin/ops/publish-blockers` → `PublishBlockerCockpitPage`.
- RPCs: `admin_get_publish_blocked_attempts(_limit)`, `admin_get_skeleton_backfill_jobs_summary()`, `admin_force_publish_course(_course_id,_reason)` (alle admin-gated SECURITY DEFINER, _reason min. 5 Zeichen, schreibt `course_publish_readiness_force_publish` Audit).
- Anzeigt: Skeleton-Backfill Folgejobs (lesson_generate_content, package_generate_lesson_minichecks, council_recompute_course_ready) gruppiert nach Status; geblockte Publish-Versuche mit Force-Publish-Dialog (Begründungspflicht).

## Level 2 (added 2026-05-05) — warn-only by default

After L1 passes, the trigger evaluates **Level-2 readiness** for the course:
`lessons_ready`, `minicheck_sets_total`, `minicheck_sets_approved`,
`pending_minicheck_jobs` (pending/queued/running/retry on
`package_generate_lesson_minichecks` + `package_validate_lesson_minichecks`),
`failed_minicheck_jobs` (failed/dead_letter).

L2 reasons collected: `NO_READY_LESSONS`, `NO_MINICHECK_SETS`,
`MINICHECKS_NOT_APPROVED`, `MINICHECK_JOBS_PENDING`, `MINICHECK_JOBS_FAILED`.

Behaviour:
- **Default (`app.publish_guard_level2` unset or `'warn'`)** → publish proceeds,
  audit row `course_publish_readiness_l2_warned` with full pipeline metadata.
- **`app.publish_guard_level2 = 'enforce'`** → publish blocked,
  `course_publish_readiness_l2_blocked` recorded.
- **Admin bypass (`app.transition_source = 'admin_force_publish'`)** under any
  L2 mode → `course_publish_readiness_l2_bypassed`.

Test surface:
- CI script: `scripts/guards/course-publish-guard-l2-test.mjs` (warn + enforce).
- E2E: `tests/e2e/course-publish-guard-l2.spec.ts`.
- Helper RPC: `admin_force_publish_course_l2_for_test(_course_id uuid)` —
  admin-only, sets enforce GUC inside the transaction.
- Workflow: `.github/workflows/course-publish-guard-l2.yml` (PR + nightly).

Promotion path to hard enforcement: enable enforce session-wide (or via
default GUC) only after the readiness cockpit shows
`empty=0, skeleton≈0, content_failed=0, minicheck_missing` explainable.
