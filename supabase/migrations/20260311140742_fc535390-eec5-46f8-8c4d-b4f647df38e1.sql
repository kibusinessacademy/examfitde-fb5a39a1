
-- FORENSIC FIX: Unblock 2 STARVATION_NO_OPEN_JOBS packages
-- Root cause: generate_learning_content step stuck in 'queued' with no job_id
-- Verkäufer (59b6e214): 200 lessons, 11 missing approved content
-- MFA (11b697be): 240 lessons, 42 missing approved content

-- 1) Verkäufer: Activate generate_learning_content step
UPDATE package_steps
SET status = 'running', started_at = now(), attempts = attempts + 1
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'generate_learning_content'
  AND status = 'queued';

-- 2) MFA: Activate generate_learning_content step
UPDATE package_steps
SET status = 'running', started_at = now(), attempts = attempts + 1
WHERE package_id = '11b697be-07a8-4164-ab1b-a8747ec49b03'
  AND step_key = 'generate_learning_content'
  AND status = 'queued';

-- 3) Verkäufer: Enqueue content generation job
INSERT INTO job_queue (package_id, job_type, status, worker_pool, payload, meta)
VALUES (
  '59b6e214-e181-4c2b-986e-1ce544984d04',
  'package_generate_learning_content',
  'pending',
  'content',
  jsonb_build_object(
    'package_id', '59b6e214-e181-4c2b-986e-1ce544984d04',
    'curriculum_id', '63635f46-0186-49e7-80c1-67925dbdf638',
    'course_id', 'ae943f8c-da2e-422e-af5f-d7ff721cbf0c'
  ),
  jsonb_build_object(
    'step_key', 'generate_learning_content',
    'trigger', 'forensic_starvation_fix',
    'missing_approved', 11
  )
);

-- 4) MFA: Enqueue content generation job
INSERT INTO job_queue (package_id, job_type, status, worker_pool, payload, meta)
VALUES (
  '11b697be-07a8-4164-ab1b-a8747ec49b03',
  'package_generate_learning_content',
  'pending',
  'content',
  jsonb_build_object(
    'package_id', '11b697be-07a8-4164-ab1b-a8747ec49b03',
    'curriculum_id', '105dd602-ea07-478f-8593-fd149ec5b676',
    'course_id', '884623f6-ac26-434e-8f0e-154015967723'
  ),
  jsonb_build_object(
    'step_key', 'generate_learning_content',
    'trigger', 'forensic_starvation_fix',
    'missing_approved', 42
  )
);

-- 5) Link jobs to steps
UPDATE package_steps ps
SET job_id = jq.id
FROM job_queue jq
WHERE jq.package_id = ps.package_id
  AND jq.job_type = 'package_generate_learning_content'
  AND jq.status = 'pending'
  AND (jq.meta->>'trigger') = 'forensic_starvation_fix'
  AND ps.step_key = 'generate_learning_content'
  AND ps.package_id IN (
    '59b6e214-e181-4c2b-986e-1ce544984d04',
    '11b697be-07a8-4164-ab1b-a8747ec49b03'
  );
