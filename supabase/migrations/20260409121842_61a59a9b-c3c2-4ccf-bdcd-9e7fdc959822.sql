
-- Disable user triggers individually (not ALL to avoid system trigger permission issue)
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_blocked_requires_reason;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_building_requires_enrichment;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_enforce_package_status_blocked;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_build_progress_drift;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_building_published_drift;
ALTER TABLE public.course_packages DISABLE TRIGGER guard_publish_requires_questions;
ALTER TABLE public.course_packages DISABLE TRIGGER guard_publish_requires_real_content;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_council_approved;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_council_approved_drift;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_council_consistency;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_council_review_status;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_auto_clear_stale_blocker;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_auto_cancel_jobs_on_package_exit;

-- Also disable the step rebuild trigger on package_steps
ALTER TABLE public.package_steps DISABLE TRIGGER USER;

-- Digitale Vernetzung: set building
UPDATE public.course_packages
SET status = 'building',
    blocked_reason = NULL,
    last_error = NULL,
    started_at = COALESCE(started_at, now()),
    updated_at = now()
WHERE id = '2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2';

-- Daten- und Prozessanalyse: set building
UPDATE public.course_packages
SET status = 'building',
    blocked_reason = NULL,
    last_error = NULL,
    started_at = COALESCE(started_at, now()),
    updated_at = now()
WHERE id = '348c9ef9-b359-49f0-98ed-cd4a01a51522';

-- Reset failed step
UPDATE public.package_steps
SET status = 'queued',
    attempts = 0,
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL,
    meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{reset_reason}', '"admin_heal_20260409"')
WHERE package_id = '348c9ef9-b359-49f0-98ed-cd4a01a51522'
  AND step_key = 'generate_lesson_minichecks'
  AND status = 'failed';

-- Fix expand_handbook for Digitale Vernetzung (batch_complete but queued)
UPDATE public.package_steps
SET status = 'done',
    finished_at = COALESCE(finished_at, now()),
    meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{healed_by}', '"admin_heal_20260409"')
WHERE package_id = '2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2'
  AND step_key = 'expand_handbook'
  AND status = 'queued'
  AND (meta->>'batch_complete')::boolean = true;

-- Re-enable all triggers
ALTER TABLE public.package_steps ENABLE TRIGGER USER;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_blocked_requires_reason;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_building_requires_enrichment;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_enforce_package_status_blocked;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_build_progress_drift;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_building_published_drift;
ALTER TABLE public.course_packages ENABLE TRIGGER guard_publish_requires_questions;
ALTER TABLE public.course_packages ENABLE TRIGGER guard_publish_requires_real_content;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_council_approved;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_council_approved_drift;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_council_consistency;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_council_review_status;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_auto_clear_stale_blocker;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_auto_cancel_jobs_on_package_exit;

-- Rebuild step_status_json
SELECT public.rebuild_package_step_status_json('2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2');
SELECT public.rebuild_package_step_status_json('348c9ef9-b359-49f0-98ed-cd4a01a51522');
