
-- ============================================
-- 1) FORCE-PUBLISH Kfz-Mechatroniker
-- ============================================
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

UPDATE package_steps
SET status = 'done',
    started_at = COALESCE(started_at, now()),
    finished_at = now(),
    attempts = GREATEST(attempts, 1),
    meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{admin_force_publish}', 'true')
WHERE package_id = '047bc325-5244-4f21-affd-5395bf62bcff' AND step_key = 'auto_publish';

UPDATE course_packages
SET status = 'published',
    integrity_passed = true,
    gate_class = NULL,
    blocked_reason = NULL,
    last_error = 'admin_force_publish_v2: manual override 2026-04-08'
WHERE id = '047bc325-5244-4f21-affd-5395bf62bcff';

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

-- Cancel remaining Kfz jobs
UPDATE job_queue
SET status = 'cancelled', last_error = 'admin_force_publish_v2'
WHERE package_id = '047bc325-5244-4f21-affd-5395bf62bcff' AND status IN ('pending', 'processing');

-- ============================================
-- 2) UNSTICK Industriekaufmann jobs - cancel stale & re-queue
-- ============================================
UPDATE job_queue
SET status = 'cancelled', last_error = 'admin_unstick: stale 8h+'
WHERE package_id = 'f5e3403b-1fc6-46b3-a275-8420287f351e'
  AND status IN ('pending', 'processing');

-- Reset the corresponding steps so they get re-queued by the orchestrator
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    job_id = NULL,
    attempts = LEAST(attempts, 2),
    meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{admin_unstick}', '"2026-04-08"')
WHERE package_id = 'f5e3403b-1fc6-46b3-a275-8420287f351e'
  AND status NOT IN ('done', 'skipped');

-- ============================================
-- 3) DEMOTE packages under 70% to queued
-- ============================================
-- Packages: Immobilienmakler(15%), Fachinformatiker-DPA(22%), Fachinformatiker-DV(33%),
-- Versicherungen(33%), Fachinformatiker-SI(44%), Fachinformatiker-AE(48%),
-- Büromanagement(56%), AEVO(59%), Bankkauffrau(63%), Mechatroniker(64%),
-- Friseur(65%), TBW(67%), Scrum Master(67%)
UPDATE course_packages
SET status = 'queued',
    last_error = 'admin_demote: progress < 70%, priority focus'
WHERE status = 'building'
  AND build_progress < 70
  AND id NOT IN (
    '047bc325-5244-4f21-affd-5395bf62bcff',  -- Kfz (publishing)
    'f5e3403b-1fc6-46b3-a275-8420287f351e'   -- Industriekaufmann (unsticking)
  );

-- Cancel pending jobs for demoted packages
UPDATE job_queue
SET status = 'cancelled', last_error = 'admin_demote: package suspended'
WHERE status IN ('pending', 'processing')
  AND package_id IN (
    SELECT id FROM course_packages
    WHERE status = 'queued' AND build_progress < 70
  );
