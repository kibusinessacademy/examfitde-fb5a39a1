
-- Delete all failed jobs for the 6 reset packages (pipeline will re-enqueue as needed)
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
