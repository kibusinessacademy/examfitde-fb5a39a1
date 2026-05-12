---
name: Track-aware Course Publish Readiness Guard v1
description: fn_guard_course_publish_readiness ist track-bewusst — EXAM_FIRST + EXAM_FIRST_PLUS (clean-skipped) bypassen modules/lessons L1-Check; AUSBILDUNG_VOLL/STUDIUM bleiben strikt
type: feature
---

## Problem
Pre-fix: Guard erzwang `modules`+`lessons` für JEDE Publish-Transition → blockierte EXAM_FIRST-Pakete (die per Design keinen Lerninhalt produzieren) mit `COURSE_PUBLISH_READINESS_BLOCKED: course X missing {modules,lessons}`.
9 Pakete in Group B + 11+ in Group C alle EXAM_FIRST/EXAM_FIRST_PLUS, integrity_check done, build_progress 80–94, hingen am auto_publish.

## Fix
- `fn_resolve_course_track(course_id)` → SECURITY DEFINER, service_role only
- `fn_lesson_steps_cleanly_skipped(course_id)` → true wenn scaffold_learning_course + fanout_learning_content + validate_lesson_minichecks alle status='skipped'
- `fn_guard_course_publish_readiness` patched:
  - EXAM_FIRST → modules/lessons aus `v_missing` strippen, Audit `course_publish_readiness_track_aware_skip`
  - EXAM_FIRST_PLUS → nur skippen wenn `fn_lesson_steps_cleanly_skipped`=true (Guardrail gegen drift)
  - AUSBILDUNG_VOLL / STUDIUM / NULL / unbekannt → bleibt strikt
  - L2 (warn-only) wird für track-skip-Fälle übersprungen (kein Lesson-Pipeline-Inhalt zu prüfen)
  - `track` ist in allen L1+L2 Audit-Metadaten enthalten

## Baseline 2026-05-12
- 148 EXAM_FIRST published (29 ohne modules — bestätigt by-design)
- 9 EXAM_FIRST_PLUS published (3 ohne modules)
- 25 AUSBILDUNG_VOLL (alle published mit modules)

## Smoke
Migration schreibt `course_publish_readiness_track_aware_smoke` mit Counts.

## Rollback
`DROP FUNCTION public.fn_resolve_course_track(uuid); DROP FUNCTION public.fn_lesson_steps_cleanly_skipped(uuid);` + Re-Apply Vorgängerversion `fn_guard_course_publish_readiness`.

## Erwarteter Effekt
- Group B (9 EXAM_FIRST Pakete) → nächster auto_publish-Retry geht durch
- Group C (Tail-Reconciler bereits per Cron) → entsperrt sich automatisch
- Kein manueller Pull-Forward, kein Repair-RPC, kein Placeholder-Content nötig
