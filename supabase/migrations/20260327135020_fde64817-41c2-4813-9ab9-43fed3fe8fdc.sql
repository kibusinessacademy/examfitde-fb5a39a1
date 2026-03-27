
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  AND status = 'blocked';

INSERT INTO job_queue (job_type, package_id, payload, status, priority)
VALUES (
  'package_run_integrity_check',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  jsonb_build_object('packageId', '9c1b3734-bb25-4986-baef-5bb1c20a212c', 'curriculum_id', '2c01d31e-e7ed-4b82-b04e-d5094d1dc179'),
  'pending',
  1
);

INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail)
VALUES ('clear_qg_heal_exhausted', 'manual_audit', 'course_package', '9c1b3734-bb25-4986-baef-5bb1c20a212c', 'success', 'Cleared QG_HEAL_EXHAUSTED block, enqueued fresh integrity check');
