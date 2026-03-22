
-- FIX 1: Steuerfachangestellter — clear loop_guard on quality_council
-- 7 council sessions are pending, loop guard blocked after 80 jobs in 24h
UPDATE package_steps
SET status = 'queued',
    meta = meta - 'loop_guard_blocked' - 'loop_guard_reason' - 'loop_guard_metrics' - 'loop_guard_blocked_at',
    updated_at = now()
WHERE package_id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
AND step_key = 'quality_council'
AND status = 'blocked';

UPDATE course_packages
SET status = 'building', blocked_reason = NULL, updated_at = now()
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
AND status = 'blocked';

-- FIX 2: P2 blocked packages — clear loop_guard on generate_learning_content
UPDATE package_steps
SET status = 'queued',
    meta = meta - 'loop_guard_blocked' - 'loop_guard_reason' - 'loop_guard_metrics' - 'loop_guard_blocked_at',
    updated_at = now()
WHERE package_id IN (
  'f2039067-e58a-4e94-9573-b5953d435873',
  'fdf4c23c-be16-43ed-ac0e-aea0ab64665f',
  '56aee54d-5fd6-4f18-90c0-c6f7f493618a'
)
AND step_key = 'generate_learning_content'
AND status = 'blocked';

UPDATE course_packages
SET status = 'building', blocked_reason = NULL, updated_at = now()
WHERE id IN (
  'f2039067-e58a-4e94-9573-b5953d435873',
  'fdf4c23c-be16-43ed-ac0e-aea0ab64665f',
  '56aee54d-5fd6-4f18-90c0-c6f7f493618a'
)
AND status = 'blocked';
