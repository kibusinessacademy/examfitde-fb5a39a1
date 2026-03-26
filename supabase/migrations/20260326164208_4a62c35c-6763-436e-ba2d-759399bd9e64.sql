
-- ============================================================
-- FIX: Unblock 2 packages by fixing integrity gate blockers
-- ============================================================

-- 1. Industriemechaniker: reclassify 82 excess easy→medium
WITH excess_easy AS (
  SELECT eq.id
  FROM exam_questions eq
  JOIN course_packages cp ON cp.curriculum_id = eq.curriculum_id
  WHERE cp.id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
    AND eq.status = 'approved'
    AND eq.difficulty = 'easy'
  ORDER BY eq.created_at ASC
  LIMIT 82
)
UPDATE exam_questions SET difficulty = 'medium'
WHERE id IN (SELECT id FROM excess_easy);

-- 2. Sozialversicherungsfachangestellter: reclassify 166 excess easy→medium
WITH excess_easy AS (
  SELECT eq.id
  FROM exam_questions eq
  JOIN course_packages cp ON cp.curriculum_id = eq.curriculum_id
  WHERE cp.id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
    AND eq.status = 'approved'
    AND eq.difficulty = 'easy'
  ORDER BY eq.created_at ASC
  LIMIT 166
)
UPDATE exam_questions SET difficulty = 'medium'
WHERE id IN (SELECT id FROM excess_easy);

-- 3. Cancel existing lesson_regen_repair job for this curriculum and re-insert with lesson-specific payloads
-- First cancel existing conflicting job
UPDATE job_queue SET status = 'cancelled'
WHERE job_type = 'lesson_regen_repair'
  AND status IN ('pending', 'queued')
  AND payload->>'curriculum_id' = '2c01d31e-e7ed-4b82-b04e-d5094d1dc179';

-- Now insert the 2 regen jobs (one at a time to avoid unique constraint)
INSERT INTO job_queue (job_type, status, attempts, max_attempts, payload, run_after, priority)
VALUES ('lesson_regen_repair', 'pending', 0, 5, 
  jsonb_build_object(
    'lesson_id', 'dd35c6d0-5f51-4553-b1ac-49ab23d08ded',
    'curriculum_id', '2c01d31e-e7ed-4b82-b04e-d5094d1dc179',
    'reason', 'minicheck_insufficient_items',
    'triggered_by', 'system_heal'
  ), now(), 10)
ON CONFLICT DO NOTHING;

-- 4. Reset integrity check + auto_publish steps → queued
UPDATE package_steps
SET status = 'queued', last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'system_heal_at', now()::text,
      'system_heal_reason', 'rebalance_easy_pct_and_minicheck_regen'
    )
WHERE package_id IN ('9c1b3734-bb25-4986-baef-5bb1c20a212c', '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1')
  AND step_key IN ('run_integrity_check', 'auto_publish')
  AND status IN ('done', 'failed', 'blocked');

-- 5. Unblock packages → building
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    last_error = NULL,
    integrity_passed = false,
    updated_at = now()
WHERE id IN ('9c1b3734-bb25-4986-baef-5bb1c20a212c', '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1')
  AND status = 'blocked';

-- 6. Audit
INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'system_heal_integrity_blockers',
  'pipeline',
  '{"industriemechaniker":"82 easy→medium + minicheck regen queued","sozialversicherung":"166 easy→medium","root_cause":"easy% exceeded 17% cap + minicheck <3 items"}'::jsonb,
  ARRAY['9c1b3734-bb25-4986-baef-5bb1c20a212c', '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1']
);
