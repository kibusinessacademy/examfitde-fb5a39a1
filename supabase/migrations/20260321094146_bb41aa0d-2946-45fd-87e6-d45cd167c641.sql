-- Enqueue finalize jobs with proper payload (curriculum_id + course_id required by guard)
INSERT INTO job_queue (job_type, package_id, status, priority, payload, created_at)
SELECT 
  'package_finalize_learning_content',
  cp.id,
  'pending',
  cp.priority,
  jsonb_build_object(
    'package_id', cp.id,
    'course_id', cp.course_id,
    'curriculum_id', cp.curriculum_id,
    'mode', 'factory'
  ),
  now()
FROM course_packages cp
WHERE cp.id IN (
  'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab',
  '56aee54d-5fd6-4f18-90c0-c6f7f493618a',
  '180c24a9-eba7-4159-ada8-140cee76f947',
  'd7fd81c3-283e-4270-acef-812b08501442',
  'f9a7900d-520b-48a3-8656-b5db4a7109dd',
  'f2039067-e58a-4e94-9573-b5953d435873',
  '268c2982-a844-49c7-9b3c-2eafe611d299',
  '570ccb3e-2937-4d81-b3d8-624b9be84737',
  'be7aa766-af51-445d-83d5-100a54007b39',
  'eff99cc4-785d-4f61-a3ef-12932d8043c3',
  '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
)
AND NOT EXISTS (
  SELECT 1 FROM job_queue jq 
  WHERE jq.package_id = cp.id 
    AND jq.job_type = 'package_finalize_learning_content' 
    AND jq.status IN ('pending', 'processing')
);

-- Mark finalize steps as enqueued
UPDATE package_steps 
SET status = 'enqueued', updated_at = now()
WHERE step_key = 'finalize_learning_content'
  AND status = 'queued'
  AND package_id IN (
    'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab',
    '56aee54d-5fd6-4f18-90c0-c6f7f493618a',
    '180c24a9-eba7-4159-ada8-140cee76f947',
    'd7fd81c3-283e-4270-acef-812b08501442',
    'f9a7900d-520b-48a3-8656-b5db4a7109dd',
    'f2039067-e58a-4e94-9573-b5953d435873',
    '268c2982-a844-49c7-9b3c-2eafe611d299',
    '570ccb3e-2937-4d81-b3d8-624b9be84737',
    'be7aa766-af51-445d-83d5-100a54007b39'
  );

-- Audit
INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'heal_stuck_finalize_mapping_gap',
  'pipeline',
  '{"reason": "ops_jobtype_step_map was missing fanout_learning_content and finalize_learning_content, causing 13 packages to stall after fanout completion", "fix": "view patched, finalize jobs enqueued for 11 packages"}'::jsonb,
  ARRAY[
    'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab', '56aee54d-5fd6-4f18-90c0-c6f7f493618a',
    '180c24a9-eba7-4159-ada8-140cee76f947', 'd7fd81c3-283e-4270-acef-812b08501442',
    'f9a7900d-520b-48a3-8656-b5db4a7109dd', 'f2039067-e58a-4e94-9573-b5953d435873',
    '268c2982-a844-49c7-9b3c-2eafe611d299', '570ccb3e-2937-4d81-b3d8-624b9be84737',
    'be7aa766-af51-445d-83d5-100a54007b39', 'eff99cc4-785d-4f61-a3ef-12932d8043c3',
    '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  ]
);