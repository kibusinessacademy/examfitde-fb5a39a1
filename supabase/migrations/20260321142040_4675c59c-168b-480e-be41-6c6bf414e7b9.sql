
-- Re-enqueue downstream jobs for Industriemechaniker (9c1b3734)
-- curriculum_id = 2c01d31e-e7ed-4b82-b04e-d5094d1dc179

-- 1. Enqueue minichecks
INSERT INTO job_queue (job_type, status, attempts, max_attempts, payload, run_after)
VALUES ('package_generate_lesson_minichecks', 'pending', 0, 5,
  '{"package_id":"9c1b3734-bb25-4986-baef-5bb1c20a212c","curriculum_id":"2c01d31e-e7ed-4b82-b04e-d5094d1dc179","triggered_by":"manual_reenqueue"}'::jsonb,
  now());

-- 2. Enqueue handbook
INSERT INTO job_queue (job_type, status, attempts, max_attempts, payload, run_after)
VALUES ('package_generate_handbook', 'pending', 0, 5,
  '{"package_id":"9c1b3734-bb25-4986-baef-5bb1c20a212c","curriculum_id":"2c01d31e-e7ed-4b82-b04e-d5094d1dc179","triggered_by":"manual_reenqueue"}'::jsonb,
  now());

-- 3. Enqueue build_ai_tutor_index
INSERT INTO job_queue (job_type, status, attempts, max_attempts, payload, run_after)
VALUES ('package_build_tutor_index', 'pending', 0, 5,
  '{"package_id":"9c1b3734-bb25-4986-baef-5bb1c20a212c","curriculum_id":"2c01d31e-e7ed-4b82-b04e-d5094d1dc179","triggered_by":"manual_reenqueue"}'::jsonb,
  now());

-- 4. Update package timestamp for watchdog
UPDATE course_packages
SET updated_at = now(), last_progress_at = now()
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c';

-- 5. Audit log
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'manual_reenqueue_industriemechaniker_downstream',
  'package',
  ARRAY['9c1b3734-bb25-4986-baef-5bb1c20a212c'],
  '{"reason":"6 failed PREREQ_NOT_DONE jobs after unblock, prereqs now fulfilled","jobs_enqueued":["minichecks","handbook","build_tutor_index"]}'::jsonb
);
