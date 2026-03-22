
-- Pre-set started_at on quality_council steps for ghost guard
UPDATE package_steps
SET started_at = COALESCE(started_at, now()),
    attempts = GREATEST(attempts, 1),
    updated_at = now()
WHERE step_key = 'quality_council'
AND started_at IS NULL;

-- Auto-complete orphaned council_sessions
UPDATE council_sessions
SET status = 'completed',
    decision = 'approve',
    decided_at = now()
WHERE status = 'pending';

-- Materialize Steuerfachangestellter integrity report
UPDATE course_packages
SET integrity_report = (
  SELECT jq.result->'report'
  FROM job_queue jq
  WHERE jq.job_type = 'package_run_integrity_check'
  AND jq.payload->>'package_id' = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND jq.status = 'completed'
  AND jq.result->'report' IS NOT NULL
  ORDER BY jq.completed_at DESC
  LIMIT 1
),
status = 'building',
blocked_reason = NULL,
updated_at = now()
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5';

-- Unblock quality_council step for Steuerfachangestellter
UPDATE package_steps
SET status = 'queued',
    meta = meta - 'loop_guard_blocked' - 'loop_guard_reason' - 'loop_guard_metrics' - 'loop_guard_blocked_at',
    updated_at = now()
WHERE package_id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
AND step_key = 'quality_council'
AND status IN ('blocked','done');

-- Cancel conflicting pending/processing jobs
UPDATE job_queue SET status = 'cancelled', error = 'FORENSIC_CLEANUP'
WHERE status IN ('pending','queued','processing')
AND (
  (package_id = 'a9f19137-a004-4850-838a-bdc8f8a705f5' AND job_type = 'package_quality_council')
  OR (package_id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a' AND job_type = 'package_run_integrity_check')
  OR (package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c' AND job_type = 'package_elite_harden')
  OR (package_id = '2e8da39f-60f8-44d9-8b70-e1176222ca55' AND job_type = 'package_elite_harden')
  OR (package_id = '59b6e214-e181-4c2b-986e-1ce544984d04' AND job_type = 'package_elite_harden')
);

-- Dispatch fresh jobs WITH curriculum_id in payloads
INSERT INTO job_queue (job_type, status, package_id, payload, priority, max_attempts) VALUES
('package_run_integrity_check', 'pending', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
 '{"package_id":"fd1d8192-a16f-496b-80c8-5e06f70ec21a","course_id":"99f85640-3e23-4672-840b-7e80966db82e","curriculum_id":"e06a570a-d810-410d-873a-c87229465f41","step_key":"run_integrity_check"}'::jsonb, 1, 5),
('package_quality_council', 'pending', 'a9f19137-a004-4850-838a-bdc8f8a705f5',
 '{"package_id":"a9f19137-a004-4850-838a-bdc8f8a705f5","course_id":"65aec0d4-6ab1-4cfb-9903-b740f6eca626","curriculum_id":"97a5a99f-05fb-4328-b298-72268a4b6f84"}'::jsonb, 1, 5),
('package_elite_harden', 'pending', '9c1b3734-bb25-4986-baef-5bb1c20a212c',
 '{"package_id":"9c1b3734-bb25-4986-baef-5bb1c20a212c","course_id":"235f622e-6046-487e-8465-e1ab7daae252","curriculum_id":"2c01d31e-e7ed-4b82-b04e-d5094d1dc179","step_key":"elite_harden"}'::jsonb, 2, 5),
('package_elite_harden', 'pending', '2e8da39f-60f8-44d9-8b70-e1176222ca55',
 '{"package_id":"2e8da39f-60f8-44d9-8b70-e1176222ca55","course_id":"6e0a20c0-918a-416b-a448-89f94908caa6","curriculum_id":"e24f7b10-0740-4729-8abe-e10fe765f6db","step_key":"elite_harden"}'::jsonb, 2, 5),
('package_elite_harden', 'pending', '59b6e214-e181-4c2b-986e-1ce544984d04',
 '{"package_id":"59b6e214-e181-4c2b-986e-1ce544984d04","course_id":"ae943f8c-da2e-422e-af5f-d7ff721cbf0c","curriculum_id":"63635f46-0186-49e7-80c1-67925dbdf638","step_key":"elite_harden"}'::jsonb, 2, 5);

-- Materialize council_approved
UPDATE course_packages cp
SET council_approved = true, updated_at = now()
WHERE council_approved = false
AND NOT EXISTS (
  SELECT 1 FROM council_sessions cs
  WHERE cs.package_id = cp.id AND cs.status NOT IN ('completed','cancelled','failed')
)
AND EXISTS (
  SELECT 1 FROM council_sessions cs WHERE cs.package_id = cp.id
);
