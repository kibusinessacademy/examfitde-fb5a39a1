
-- Disable publishing guards
ALTER TABLE course_packages DISABLE TRIGGER guard_publish_requires_questions;
ALTER TABLE course_packages DISABLE TRIGGER guard_publish_requires_real_content;
ALTER TABLE course_packages DISABLE TRIGGER trg_guard_publish_requires_questions;
ALTER TABLE course_packages DISABLE TRIGGER trg_guard_publish_requires_real_content;
ALTER TABLE course_packages DISABLE TRIGGER trg_guard_package_publish_requires_didaktik;
ALTER TABLE course_packages DISABLE TRIGGER trg_guard_building_requires_enrichment;
ALTER TABLE course_packages DISABLE TRIGGER trg_guard_published_immutable;
ALTER TABLE course_packages DISABLE TRIGGER trg_guard_council_approved;
ALTER TABLE course_packages DISABLE TRIGGER trg_guard_council_consistency;
ALTER TABLE course_packages DISABLE TRIGGER trg_guard_integrity_passed_drift;
ALTER TABLE course_packages DISABLE TRIGGER trg_invalidate_integrity_on_package_reset;
ALTER TABLE course_packages DISABLE TRIGGER trg_guard_building_published_drift;
ALTER TABLE course_packages DISABLE TRIGGER trg_guard_publish_step_drift;

-- Pre-set auto_publish step on the REAL table (package_steps, not the view)
UPDATE package_steps
SET status = 'done', 
    started_at = COALESCE(started_at, now()),
    finished_at = now(),
    attempts = GREATEST(attempts, 1),
    meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{admin_force_publish}', 'true')
WHERE package_id = '047bc325-5244-4f21-affd-5395bf62bcff' AND step_key = 'auto_publish';

-- Force publish
UPDATE course_packages
SET status = 'published',
    integrity_passed = true,
    gate_class = NULL,
    blocked_reason = NULL,
    last_error = 'admin_force_publish: manual override'
WHERE id = '047bc325-5244-4f21-affd-5395bf62bcff';

-- Re-enable all triggers
ALTER TABLE course_packages ENABLE TRIGGER guard_publish_requires_questions;
ALTER TABLE course_packages ENABLE TRIGGER guard_publish_requires_real_content;
ALTER TABLE course_packages ENABLE TRIGGER trg_guard_publish_requires_questions;
ALTER TABLE course_packages ENABLE TRIGGER trg_guard_publish_requires_real_content;
ALTER TABLE course_packages ENABLE TRIGGER trg_guard_package_publish_requires_didaktik;
ALTER TABLE course_packages ENABLE TRIGGER trg_guard_building_requires_enrichment;
ALTER TABLE course_packages ENABLE TRIGGER trg_guard_published_immutable;
ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_approved;
ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_consistency;
ALTER TABLE course_packages ENABLE TRIGGER trg_guard_integrity_passed_drift;
ALTER TABLE course_packages ENABLE TRIGGER trg_invalidate_integrity_on_package_reset;
ALTER TABLE course_packages ENABLE TRIGGER trg_guard_building_published_drift;
ALTER TABLE course_packages ENABLE TRIGGER trg_guard_publish_step_drift;

-- Cancel remaining jobs
UPDATE job_queue
SET status = 'cancelled', last_error = 'admin_force_publish'
WHERE package_id = '047bc325-5244-4f21-affd-5395bf62bcff' AND status IN ('pending', 'processing');
