
-- UNBLOCK: Set run_after to now() so core-runner claims the publish job immediately
UPDATE job_queue
SET run_after = now(),
    updated_at = now()
WHERE id = '5ba9cdb3-ad01-4b24-b035-cc2d4abc0539'
  AND status = 'pending';

-- AUDIT
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'unblock_publish_job_run_after',
  'job_queue',
  ARRAY['5ba9cdb3-ad01-4b24-b035-cc2d4abc0539', '9c1b3734-bb25-4986-baef-5bb1c20a212c'],
  '{"reason": "run_after was set to future (08:29) by retry logic, preventing claim of the only pending job. Package Industriemechaniker is 96% complete and ready for publish."}'::jsonb
);
