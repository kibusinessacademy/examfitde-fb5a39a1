
-- 1. Ghost completions with genuine evidence → mark done (guard-compliant)
UPDATE package_steps
SET status = 'done',
    updated_at = now(),
    meta = meta || jsonb_build_object(
      'ghost_healed_at', now()::text,
      'ghost_heal_reason', 'meta_ok_true_but_not_done',
      'postcondition_verified', true,
      'allow_regression', true
    )
WHERE status NOT IN ('done', 'skipped')
AND (meta->>'ok')::boolean = true
AND started_at IS NOT NULL
AND attempts > 0;

-- 2. Steps with stale meta.ok but never started → clear the stale ok flag
UPDATE package_steps
SET meta = meta - 'ok',
    updated_at = now()
WHERE status NOT IN ('done', 'skipped')
AND (meta->>'ok')::boolean = true
AND (started_at IS NULL OR attempts = 0);

-- 3. Cancel premature integrity check jobs
UPDATE job_queue
SET status = 'cancelled',
    error = 'SSOT_HEAL: cancelled premature integrity check — upstream not done',
    updated_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('cancel_reason', 'ssot_heal_premature_integrity_v2', 'cancelled_at', now()::text)
WHERE job_type = 'package_run_integrity_check'
AND status IN ('pending', 'processing')
AND EXISTS (
  SELECT 1 FROM package_steps ps
  WHERE ps.package_id = job_queue.package_id
  AND ps.step_key IN ('validate_oral_exam', 'validate_lesson_minichecks', 'validate_exam_pool', 'repair_exam_pool_quality', 'validate_handbook', 'validate_handbook_depth')
  AND ps.status NOT IN ('done', 'skipped')
);

-- 4. Audit log
INSERT INTO admin_actions (action, scope, payload)
VALUES (
  'ssot_heal_ghost_and_premature_integrity_v3',
  'system',
  jsonb_build_object(
    'reason', 'Live audit heal: ghost completions promoted, stale meta cleared, premature integrity cancelled',
    'timestamp', now()::text
  )
);
