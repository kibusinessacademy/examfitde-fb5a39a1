
-- Track A: Unblock Elektroniker
UPDATE course_packages
SET status = 'building', blocked_reason = NULL, updated_at = now()
WHERE id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a' AND status = 'blocked';

UPDATE package_steps
SET status = 'queued', started_at = NULL, finished_at = NULL, last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"unblocked_by":"sprint_reconcile"}'::jsonb
WHERE package_id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  AND step_key = 'auto_publish' AND status = 'blocked';

-- Track A: Dispatch integrity jobs with curriculum_id
INSERT INTO job_queue (job_type, package_id, status, payload, max_attempts, priority) VALUES
('package_run_integrity_check', '2e8da39f-60f8-44d9-8b70-e1176222ca55', 'pending',
 '{"package_id":"2e8da39f-60f8-44d9-8b70-e1176222ca55","curriculum_id":"e24f7b10-0740-4729-8abe-e10fe765f6db","triggered_by":"sprint_reconcile"}'::jsonb, 3, 5),
('package_run_integrity_check', '59b6e214-e181-4c2b-986e-1ce544984d04', 'pending',
 '{"package_id":"59b6e214-e181-4c2b-986e-1ce544984d04","curriculum_id":"63635f46-0186-49e7-80c1-67925dbdf638","triggered_by":"sprint_reconcile"}'::jsonb, 3, 5),
('package_run_integrity_check', '9c1b3734-bb25-4986-baef-5bb1c20a212c', 'pending',
 '{"package_id":"9c1b3734-bb25-4986-baef-5bb1c20a212c","curriculum_id":"2c01d31e-e7ed-4b82-b04e-d5094d1dc179","triggered_by":"sprint_reconcile"}'::jsonb, 3, 5),
('package_run_integrity_check', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a', 'pending',
 '{"package_id":"fd1d8192-a16f-496b-80c8-5e06f70ec21a","curriculum_id":"e06a570a-d810-410d-873a-c87229465f41","triggered_by":"sprint_unblock"}'::jsonb, 3, 5);

-- Track B: Dispatch council jobs
INSERT INTO job_queue (job_type, package_id, status, payload, max_attempts, priority) VALUES
('package_quality_council', 'a9f19137-a004-4850-838a-bdc8f8a705f5', 'pending',
 '{"package_id":"a9f19137-a004-4850-838a-bdc8f8a705f5","curriculum_id":"97a5a99f-05fb-4328-b298-72268a4b6f84","triggered_by":"sprint_council_dispatch"}'::jsonb, 5, 8),
('package_quality_council', '11b697be-07a8-4164-ab1b-a8747ec49b03', 'pending',
 '{"package_id":"11b697be-07a8-4164-ab1b-a8747ec49b03","curriculum_id":"105dd602-ea07-478f-8593-fd149ec5b676","triggered_by":"sprint_council_dispatch"}'::jsonb, 5, 8),
('package_quality_council', '047bc325-5244-4f21-affd-5395bf62bcff', 'pending',
 '{"package_id":"047bc325-5244-4f21-affd-5395bf62bcff","curriculum_id":"fbc805ce-e798-4cf6-a189-20f147ae0f38","triggered_by":"sprint_council_dispatch"}'::jsonb, 5, 8),
('package_quality_council', 'f5e3403b-1fc6-46b3-a275-8420287f351e', 'pending',
 '{"package_id":"f5e3403b-1fc6-46b3-a275-8420287f351e","curriculum_id":"055098ff-7cb0-4373-bd87-ff1979afc646","triggered_by":"sprint_council_dispatch"}'::jsonb, 5, 8);

-- Audit
INSERT INTO admin_actions (action, scope, payload)
VALUES ('sprint_reconcile_and_dispatch', 'sprint_march_2026',
  '{"track_a_unblocked":["fd1d8192"],"track_a_integrity":["2e8da39f","59b6e214","9c1b3734","fd1d8192"],"track_b_council":["a9f19137","11b697be","047bc325","f5e3403b"]}'::jsonb);
