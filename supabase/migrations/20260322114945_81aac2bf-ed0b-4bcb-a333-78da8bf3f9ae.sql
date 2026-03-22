-- HEALING MIGRATION: Fix all identified root causes

-- 1. Steuerfachangestellter: Unblock auto_publish (integrity just passed 100/100)
UPDATE course_packages
SET blocked_reason = NULL,
    status = 'building',
    updated_at = now()
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND blocked_reason IS NOT NULL;

-- Reset auto_publish step from blocked to queued
UPDATE package_steps
SET status = 'queued',
    meta = COALESCE(meta, '{}'::jsonb) || '{"healed_at":"2026-03-22T11:49:00Z","heal_reason":"integrity_passed_100_unblock"}'::jsonb,
    updated_at = now()
WHERE package_id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND step_key = 'auto_publish'
  AND status = 'blocked';

-- 2. Elektroniker Betriebstechnik: Reset quality_gate_failed → building
UPDATE course_packages
SET status = 'building',
    updated_at = now()
WHERE id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  AND status = 'quality_gate_failed';

-- 3. Cancel premature OPS_GUARD/PREREQ_NOT_DONE jobs
UPDATE job_queue SET status = 'cancelled', updated_at = now()
WHERE id IN (
  'b85063e5-57cc-44cb-8cd2-5f2ecfdd40c9',
  '98c7905b-644a-41ba-9f2c-954695418f09',
  '0df6972c-dbd5-4dcf-9fa8-271324579f0f',
  '6a286f60-080b-4867-b179-f519989f01a1',
  '5eec302e-78d0-4b9f-8393-44884312e670',
  'ef5c5c91-1753-4bb1-a938-ffc9f5aadce6'
)
AND status IN ('pending','queued');

-- 4. Clear informational stuck_reason on active building packages
UPDATE course_packages
SET stuck_reason = NULL, updated_at = now()
WHERE status = 'building'
  AND stuck_reason IS NOT NULL
  AND blocked_reason IS NULL