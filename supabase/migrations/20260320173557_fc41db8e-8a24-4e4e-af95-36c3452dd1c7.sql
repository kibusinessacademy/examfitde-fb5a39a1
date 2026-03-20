-- ═══════════════════════════════════════════════════════════════
-- P2: Repair Verwaltungsfachangestellte burned downstream jobs
-- Re-enqueue with fresh state (old failed jobs left as-is for audit)
-- ═══════════════════════════════════════════════════════════════

-- 1. Insert fresh blueprint seeding job (prereq for exam pool)
INSERT INTO job_queue (job_type, package_id, payload, priority, max_attempts, status, run_after)
SELECT 
  'package_auto_seed_exam_blueprints',
  'be7aa766-af51-445d-83d5-100a54007b39',
  jsonb_build_object(
    'package_id', 'be7aa766-af51-445d-83d5-100a54007b39',
    'course_id', 'ac7cb4ea-df75-4549-956d-d5a6d31d1575',
    'curriculum_id', '47e1c73e-e5f9-4042-906f-90da2c63b98a'
  ),
  12, 5, 'pending',
  now() + interval '30 seconds'
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue 
  WHERE job_type = 'package_auto_seed_exam_blueprints' 
    AND package_id = 'be7aa766-af51-445d-83d5-100a54007b39'
    AND status IN ('pending', 'processing')
);

-- 2. Insert fresh exam pool job (will self-defer until blueprints are done)
INSERT INTO job_queue (job_type, package_id, payload, priority, max_attempts, status, run_after)
SELECT 
  'package_generate_exam_pool',
  'be7aa766-af51-445d-83d5-100a54007b39',
  jsonb_build_object(
    'package_id', 'be7aa766-af51-445d-83d5-100a54007b39',
    'course_id', 'ac7cb4ea-df75-4549-956d-d5a6d31d1575',
    'curriculum_id', '47e1c73e-e5f9-4042-906f-90da2c63b98a'
  ),
  12, 5, 'pending',
  now() + interval '5 minutes'
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue 
  WHERE job_type = 'package_generate_exam_pool' 
    AND package_id = 'be7aa766-af51-445d-83d5-100a54007b39'
    AND status IN ('pending', 'processing')
);

-- 3. Insert fresh minichecks job (will self-defer until validate_learning_content is done)
INSERT INTO job_queue (job_type, package_id, payload, priority, max_attempts, status, run_after)
SELECT 
  'package_generate_lesson_minichecks',
  'be7aa766-af51-445d-83d5-100a54007b39',
  jsonb_build_object(
    'package_id', 'be7aa766-af51-445d-83d5-100a54007b39',
    'course_id', 'ac7cb4ea-df75-4549-956d-d5a6d31d1575',
    'curriculum_id', '47e1c73e-e5f9-4042-906f-90da2c63b98a'
  ),
  10, 5, 'pending',
  now() + interval '10 minutes'
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue 
  WHERE job_type = 'package_generate_lesson_minichecks' 
    AND package_id = 'be7aa766-af51-445d-83d5-100a54007b39'
    AND status IN ('pending', 'processing')
);

-- 4. Insert fresh handbook job (will self-defer until validate_learning_content is done)
INSERT INTO job_queue (job_type, package_id, payload, priority, max_attempts, status, run_after)
SELECT 
  'package_generate_handbook',
  'be7aa766-af51-445d-83d5-100a54007b39',
  jsonb_build_object(
    'package_id', 'be7aa766-af51-445d-83d5-100a54007b39',
    'course_id', 'ac7cb4ea-df75-4549-956d-d5a6d31d1575',
    'curriculum_id', '47e1c73e-e5f9-4042-906f-90da2c63b98a'
  ),
  10, 5, 'pending',
  now() + interval '10 minutes'
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue 
  WHERE job_type = 'package_generate_handbook' 
    AND package_id = 'be7aa766-af51-445d-83d5-100a54007b39'
    AND status IN ('pending', 'processing')
);

-- 5. Insert fresh oral exam job (will self-defer until validate_tutor_index is done)
INSERT INTO job_queue (job_type, package_id, payload, priority, max_attempts, status, run_after)
SELECT 
  'package_generate_oral_exam',
  'be7aa766-af51-445d-83d5-100a54007b39',
  jsonb_build_object(
    'package_id', 'be7aa766-af51-445d-83d5-100a54007b39',
    'course_id', 'ac7cb4ea-df75-4549-956d-d5a6d31d1575',
    'curriculum_id', '47e1c73e-e5f9-4042-906f-90da2c63b98a'
  ),
  10, 5, 'pending',
  now() + interval '10 minutes'
WHERE NOT EXISTS (
  SELECT 1 FROM job_queue 
  WHERE job_type = 'package_generate_oral_exam' 
    AND package_id = 'be7aa766-af51-445d-83d5-100a54007b39'
    AND status IN ('pending', 'processing')
);