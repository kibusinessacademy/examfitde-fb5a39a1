
-- Step 1: Delete failed jobs first to avoid idempotency constraint
DELETE FROM job_queue
WHERE payload->>'package_id' IN (
  'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb',
  '70f0a909-2d44-4b8b-97a3-0aa9679b3704',
  '2ec30a3a-7d6e-42bd-a643-e78f6e4c3709',
  '259894ef-5d62-4692-bd21-a8250fe4b389',
  '65c74607-9f65-4b21-8fb9-a8c7f3aa3d92',
  '015e3cc4-b9c4-42f1-926d-346f3844030a'
)
AND status = 'failed';

-- Step 2: Reset packages to building
UPDATE course_packages
SET status = 'building',
    updated_at = now()
WHERE id IN (
  'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb',
  '70f0a909-2d44-4b8b-97a3-0aa9679b3704',
  '2ec30a3a-7d6e-42bd-a643-e78f6e4c3709',
  '259894ef-5d62-4692-bd21-a8250fe4b389',
  '65c74607-9f65-4b21-8fb9-a8c7f3aa3d92',
  '015e3cc4-b9c4-42f1-926d-346f3844030a'
)
AND status = 'failed';

-- Step 3: Reset non-done steps
UPDATE package_steps
SET last_error = NULL,
    meta = jsonb_set(
      COALESCE(meta, '{}'::jsonb),
      '{attempts}',
      '0'
    ),
    started_at = NULL,
    finished_at = NULL,
    updated_at = now()
WHERE package_id IN (
  'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb',
  '70f0a909-2d44-4b8b-97a3-0aa9679b3704',
  '2ec30a3a-7d6e-42bd-a643-e78f6e4c3709',
  '259894ef-5d62-4692-bd21-a8250fe4b389',
  '65c74607-9f65-4b21-8fb9-a8c7f3aa3d92',
  '015e3cc4-b9c4-42f1-926d-346f3844030a'
)
AND status NOT IN ('done', 'skipped');
