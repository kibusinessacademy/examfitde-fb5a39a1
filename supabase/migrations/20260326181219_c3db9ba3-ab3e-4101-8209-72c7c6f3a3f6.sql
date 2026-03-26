
-- Industriemechaniker: re-run integrity with fresh state
-- The old report was based on stale data. Reset and re-check.
UPDATE course_packages
SET integrity_passed = false,
    integrity_report = NULL,
    integrity_report_version = NULL,
    status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c';

UPDATE package_steps
SET status = 'queued', updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
AND step_key = 'run_integrity_check';

INSERT INTO job_queue (job_type, package_id, status, priority, payload)
SELECT 'package_run_integrity_check', cp.id, 'pending', 15,
  jsonb_build_object('package_id', cp.id, 'curriculum_id', cp.curriculum_id)
FROM course_packages cp
WHERE cp.id = '9c1b3734-bb25-4986-baef-5bb1c20a212c';
