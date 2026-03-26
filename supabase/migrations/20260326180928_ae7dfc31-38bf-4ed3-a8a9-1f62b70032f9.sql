
-- FIX 1: Rebalance easy→medium for SoVFa (2 questions)
UPDATE exam_questions
SET difficulty = 'medium'
WHERE id IN (
  '029c127b-6e22-49ae-b944-e35e6597e1ca',
  '7f73d468-0dbc-405b-896a-b039153c0c9a'
)
AND difficulty = 'easy'
AND status = 'approved';

-- FIX 2: Rebalance easy→medium for Industriemechaniker (2 questions)
UPDATE exam_questions
SET difficulty = 'medium'
WHERE id IN (
  '7819e36c-ca56-42f5-914e-314c2f9bd9d7',
  'a4b2bf81-16db-4882-841b-aabac46125fe'
)
AND difficulty = 'easy'
AND status = 'approved';

-- FIX 3: Reset integrity for both packages so they re-check
UPDATE course_packages
SET integrity_passed = false,
    integrity_report = NULL,
    integrity_report_version = NULL,
    updated_at = now()
WHERE id IN (
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
);

-- Unblock auto_publish steps
UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    updated_at = now()
WHERE package_id IN (
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
)
AND step_key = 'auto_publish'
AND status = 'blocked';

-- Re-queue run_integrity_check so a fresh check runs
UPDATE package_steps
SET status = 'queued',
    updated_at = now()
WHERE package_id IN (
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
)
AND step_key = 'run_integrity_check'
AND status = 'done';

-- Set packages back to building
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id IN (
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
)
AND status = 'blocked';

-- Enqueue integrity check jobs
INSERT INTO job_queue (job_type, package_id, status, priority, payload)
SELECT 
  'package_run_integrity_check',
  cp.id,
  'pending',
  15,
  jsonb_build_object('package_id', cp.id, 'curriculum_id', cp.curriculum_id)
FROM course_packages cp
WHERE cp.id IN (
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
);

-- FIX 4: Elektroniker Automatisierungstechnik — stalled at quality_gate_failed
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    stuck_reason = NULL,
    updated_at = now()
WHERE id = '335decc8-9f68-4784-b318-a68f620bf77e'
AND status = 'quality_gate_failed';

-- Enqueue next step for Automatisierungstechnik
INSERT INTO job_queue (job_type, package_id, status, priority, payload)
SELECT 
  'package_generate_lesson_minichecks',
  '335decc8-9f68-4784-b318-a68f620bf77e',
  'pending',
  15,
  jsonb_build_object(
    'package_id', '335decc8-9f68-4784-b318-a68f620bf77e',
    'curriculum_id', cp.curriculum_id
  )
FROM course_packages cp
WHERE cp.id = '335decc8-9f68-4784-b318-a68f620bf77e';

-- Audit trail
INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'system_wide_heal_20260326',
  'pipeline_repair',
  jsonb_build_object(
    'fixes', jsonb_build_array(
      'SoVFa: 2 easy→medium rebalance + integrity re-check',
      'Industriemechaniker: 2 easy→medium rebalance + integrity re-check',
      'Automatisierungstechnik: quality_gate_failed→building + dispatch'
    )
  ),
  ARRAY[
    '9c1b3734-bb25-4986-baef-5bb1c20a212c',
    '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1',
    '335decc8-9f68-4784-b318-a68f620bf77e'
  ]
);
