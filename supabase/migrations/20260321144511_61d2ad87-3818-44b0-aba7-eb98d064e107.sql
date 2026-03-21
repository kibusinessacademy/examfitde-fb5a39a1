
-- Cleanup: Cancel 19 premature PREREQ_NOT_DONE / MATERIALIZATION_GUARD / UNKNOWN_JOB_TYPE failed jobs
-- Packages: Fachinformatiker, Dialogmarketing, Industriemechaniker
-- These jobs were dispatched before prerequisites were fulfilled.

UPDATE job_queue
SET status = 'cancelled',
    error = COALESCE(error, '') || ' | cleanup: premature_dispatch_cancelled_' || now()::text
WHERE id IN (
  -- Dialogmarketing (268c2982)
  '8afe94ae-f3d7-4cee-b17e-1bb546ada8fd',
  'de799f19-b89b-451c-abd0-7c2698ba833e',
  '708747f0-2c4d-467f-837c-8f1ad3a3c55d',
  'd2a1cc8b-4b4a-4ae9-9be3-c6ef47dc2009',
  '29f11399-ca99-440b-abf0-60022b040197',
  '54c7810a-c88e-439b-84c3-41f7cb5e7df5',
  'bc842a5a-300f-43d6-b377-a1cfabe24c58',
  '4c17133a-eac3-4d0a-80a3-7f7f23b5c990',
  -- Industriemechaniker (9c1b3734) — inkl. falscher Jobname
  '6348e079-9ecd-4f24-ab7d-463e849d3376',
  'd3a63365-2b01-4689-8da0-c9d204e84b16',
  '70df49dd-be74-44b8-8e78-4cc655d23de8',
  'b29db471-6813-483c-a440-e67127c1a6a1',
  '6465dd6f-5069-4d64-8d1e-3f3fdb9c287a',
  'df77781a-188b-4c48-922e-ca56b6fbf26a',
  'c22f33c3-18ef-4a5f-8beb-a543fdfdb444',
  -- Fachinformatiker (f9a7900d)
  'fca65181-9c8e-4245-b91f-94effb279bf6',
  'c971a917-a83d-45ff-9e1e-9371d0300561',
  '11cecf70-58b7-4be7-9c42-6e5d3125b560',
  'ff957955-9b1f-4afe-b916-6eb82db7ba4c'
)
AND status = 'failed';

-- Audit log
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'cleanup_premature_dispatch_409_fails',
  'job_queue',
  ARRAY[
    'f9a7900d-520b-48a3-8656-b5db4a7109dd',
    '268c2982-a844-49c7-9b3c-2eafe611d299',
    '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  ],
  '{
    "reason": "19 failed jobs from premature downstream dispatch (PREREQ_NOT_DONE/MATERIALIZATION_GUARD/UNKNOWN_JOB_TYPE)",
    "action": "status set to cancelled, auto-heal will re-dispatch when prereqs are fulfilled",
    "packages": ["Fachinformatiker","Dialogmarketing","Industriemechaniker"],
    "job_count": 19
  }'::jsonb
);
