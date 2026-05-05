---
name: Empty-Published-Courses Ratchet v1
description: Cleanup tooling + CI report to drive empty-published courses → 0; admin RPCs for demote and skeleton-backfill.
type: feature
---

## Ziel
Published-Courses ohne Module/Lessons stufenweise abbauen: 34 → 30 → 20 → 10 → 0.

## SSOT
- View `v_admin_empty_published_courses` klassifiziert jeden empty published Course in:
  - `duplicate_curriculum` — anderer published Course mit Modulen existiert für dasselbe Curriculum → demote
  - `duplicate_title` — Titel-Twin mit Modulen existiert → demote (Review)
  - `no_curriculum_phantom` — `curriculum_id IS NULL` → demote
  - `backfill_candidate` — Curriculum hat `learning_fields` → `admin_backfill_course_skeleton`
  - `unknown` — manuelle Triage
- View ist admin-locked (REVOKE FROM PUBLIC/anon/authenticated, GRANT service_role).

## Admin-RPCs (alle `has_role('admin')`-gated)
- `admin_get_empty_published_courses()` — gibt klassifizierte Liste zurück.
- `admin_demote_empty_course(_course_id, _reason)` — setzt `status='draft'`, `published_at=NULL`. Refused wenn Module existieren. Audit `empty_course_demoted_to_draft` in `auto_heal_log`.
- `admin_backfill_course_skeleton(_course_id)` — erzeugt 1 Module pro Learning Field + 1 Einstieg-Lesson (status `draft`, `generation_status='queued'`). Refused wenn Module existieren oder Curriculum fehlt. Audit `empty_course_skeleton_backfilled`.

## CI
- `scripts/guards/empty-courses-report.mjs` schreibt `empty-courses.{json,md}` + GitHub Step Summary mit Cluster-Counts.
- Workflow `.github/workflows/empty-courses-ratchet.yml` (PR-trigger + täglich 05:37 UTC) lädt das Report-Artifact hoch.
- `learner-course-readiness.mjs --max-empty=30` (Schritt 1, Baseline 34→30). Nächste Stufen: 20, 10, 0.

## Memory-Trail
- Baseline 2026-05-05: 177 published / 143 ready / 34 empty (≈30 backfill_candidate).
