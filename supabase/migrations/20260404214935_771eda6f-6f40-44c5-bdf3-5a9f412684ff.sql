
-- 1. Kaufmann: Reset generate_lesson_minichecks to re-run for uncovered lessons
UPDATE package_steps 
SET status = 'queued',
    meta = meta || jsonb_build_object(
      'allow_regression', true,
      'allow_regression_by', 'admin_manual',
      'last_reset_reason', 'minicheck_coverage_gap_60pct',
      'reset_at', now()::text
    )
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7' 
  AND step_key = 'generate_lesson_minichecks';

-- Also reset validate_lesson_minichecks
UPDATE package_steps 
SET status = 'queued',
    meta = meta || jsonb_build_object(
      'allow_regression', true,
      'allow_regression_by', 'admin_manual',
      'last_reset_reason', 'minicheck_coverage_gap_60pct'
    )
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7' 
  AND step_key = 'validate_lesson_minichecks';

-- Enqueue generation job for Kaufmann
INSERT INTO job_queue (id, job_type, status, payload, priority, package_id, worker_pool)
VALUES (
  gen_random_uuid(), 
  'package_generate_lesson_minichecks', 
  'pending',
  jsonb_build_object(
    'package_id', '5377ab93-fe17-488c-a266-bdb26b672da7',
    'curriculum_id', '33eb7832-8c80-46fa-a3ad-a9a5ee996e87',
    'reason', 'coverage_gap_reseed'
  ),
  5,
  '5377ab93-fe17-488c-a266-bdb26b672da7',
  'content'
);

-- 2. WInf: Enqueue missing jobs for enqueued steps (blueprint variants is the current blocker)
INSERT INTO job_queue (id, job_type, status, payload, priority, package_id, worker_pool)
SELECT gen_random_uuid(), 'package_generate_glossary', 'pending',
  jsonb_build_object('package_id', 'c5000000-0004-4000-8000-000000000001', 'curriculum_id', 'c2000000-0004-4000-8000-000000000001', 'reason', 'stall_recovery'),
  10, 'c5000000-0004-4000-8000-000000000001', 'content'
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id = 'c5000000-0004-4000-8000-000000000001' AND job_type = 'package_generate_glossary' AND status IN ('pending','processing')
);

INSERT INTO job_queue (id, job_type, status, payload, priority, package_id, worker_pool)
SELECT gen_random_uuid(), 'package_generate_handbook', 'pending',
  jsonb_build_object('package_id', 'c5000000-0004-4000-8000-000000000001', 'curriculum_id', 'c2000000-0004-4000-8000-000000000001', 'reason', 'stall_recovery'),
  10, 'c5000000-0004-4000-8000-000000000001', 'content'
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id = 'c5000000-0004-4000-8000-000000000001' AND job_type = 'package_generate_handbook' AND status IN ('pending','processing')
);

INSERT INTO job_queue (id, job_type, status, payload, priority, package_id, worker_pool)
SELECT gen_random_uuid(), 'package_generate_lesson_minichecks', 'pending',
  jsonb_build_object('package_id', 'c5000000-0004-4000-8000-000000000001', 'curriculum_id', 'c2000000-0004-4000-8000-000000000001', 'reason', 'stall_recovery'),
  10, 'c5000000-0004-4000-8000-000000000001', 'content'
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id = 'c5000000-0004-4000-8000-000000000001' AND job_type = 'package_generate_lesson_minichecks' AND status IN ('pending','processing')
);

-- 3. Verwaltung: Enqueue auto_publish job
INSERT INTO job_queue (id, job_type, status, payload, priority, package_id, worker_pool)
SELECT gen_random_uuid(), 'package_auto_publish', 'pending',
  jsonb_build_object('package_id', 'be7aa766-af51-445d-83d5-100a54007b39', 'curriculum_id', '47e1c73e-e5f9-4042-906f-90da2c63b98a', 'reason', 'missing_job_recovery'),
  1, 'be7aa766-af51-445d-83d5-100a54007b39', 'content'
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue WHERE package_id = 'be7aa766-af51-445d-83d5-100a54007b39' AND job_type = 'package_auto_publish' AND status IN ('pending','processing')
);
