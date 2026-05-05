---
name: Course Pipeline Readiness v1 (Phase 1 warn-only)
description: SSOT-View v_admin_course_pipeline_readiness klassifiziert published Kurse in empty/skeleton/content_failed/content_pending/minicheck_missing/ready_to_publish. Phase 1 = warn-only Sichtbarkeit + Audit; Phase 2 = harter Guard für neue Kurse; Phase 3 = harter Guard für alle.
type: feature
---

## Schema-Klassifikation
- `empty`: modules=0 oder lessons_total=0
- `skeleton`: alle Lessons placeholder ODER lessons_ready=0
- `content_failed`: failed/cancelled Backfill-Jobs vorhanden
- `content_pending`: pending/queued/processing Backfill-Jobs
- `minicheck_missing`: minichecks_total=0 (über lessons.competency_id → exam_questions)
- `ready_to_publish`: alles erfüllt

`primary_blocker`: NO_MODULES | NO_LESSONS | NO_READY_LESSONS | PLACEHOLDER_LESSONS | JOBS_FAILED | JOBS_PENDING | MINICHECKS_MISSING | NULL

## RPCs (alle admin-gated SECURITY DEFINER)
- `admin_get_course_pipeline_readiness(_filter,_limit)` — published only, sortiert nach Schweregrad
- `admin_get_skeleton_backfill_jobs_for_course(_course_id)` — per-course Job-Liste
- `admin_retry_skeleton_backfill_job(_job_id)` — failed/cancelled → pending, attempts=0, Audit
- `admin_requeue_skeleton_backfill_jobs_for_course(_course_id)` — Bulk failed/cancelled → pending, Audit

## Audit
- `skeleton_backfill_job_retried` (target_type=job)
- `skeleton_backfill_jobs_requeued` (target_type=course, metadata.jobs_requeued)

## UI
- `PipelineReadinessCard` in `/admin/ops/publish-blockers` zwischen Skeleton-Folgejobs und Blocker-Tabelle.
- Filter pro Level, Per-Course Retry-Dialog mit Job-Liste, Bulk-Requeue-Button bei failed_jobs>0.

## Roadmap
- Phase 1 (jetzt): warn-only Card.
- Phase 2: Trigger blockt Publish wenn `readiness_level != 'ready_to_publish'` für neue Kurse (Bypass via `app.transition_source='admin_force_publish'` + Audit).
- Phase 3: Bestand auf ready_to_publish ratcheten.
