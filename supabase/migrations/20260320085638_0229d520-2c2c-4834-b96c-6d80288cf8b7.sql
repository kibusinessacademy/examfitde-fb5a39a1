
INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta)
SELECT 
  'validate_learning_content',
  cp.id,
  'pending',
  cp.priority,
  jsonb_build_object('package_id', cp.id, 'curriculum_id', cp.curriculum_id),
  jsonb_build_object('trigger', 'drift_reconcile', 'step_key', 'validate_learning_content')
FROM course_packages cp
WHERE cp.id IN (
  'eff99cc4-785d-4f61-a3ef-12932d8043c3',
  'd7fd81c3-283e-4270-acef-812b08501442',
  'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab',
  '268c2982-a844-49c7-9b3c-2eafe611d299'
)
AND NOT EXISTS (
  SELECT 1 FROM job_queue jq 
  WHERE jq.package_id = cp.id 
    AND jq.job_type = 'validate_learning_content'
    AND jq.status IN ('pending','processing')
);

INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'drift_reconcile_reenqueue',
  'job_queue',
  '{"reason":"stalled_packages_no_active_jobs","step":"validate_learning_content"}'::jsonb,
  ARRAY[
    'eff99cc4-785d-4f61-a3ef-12932d8043c3',
    'd7fd81c3-283e-4270-acef-812b08501442',
    'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab',
    '268c2982-a844-49c7-9b3c-2eafe611d299'
  ]
);
