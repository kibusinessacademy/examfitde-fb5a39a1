
-- Fix meta drift on generate_learning_content step for Verkäufer package
-- Root cause: needs_regen=0 but 6 tier1_failed lessons, phantom active_lesson_jobs=1
UPDATE package_steps
SET meta = jsonb_set(
  jsonb_set(
    (COALESCE(meta, '{}'::jsonb) - 'dispatch_blocked_reason' - 'active_lesson_jobs'),
    '{needs_regen}', '6'
  ),
  '{meta_drift_fixed_at}', to_jsonb(now()::text)
),
    attempts = 0,
    last_error = NULL
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
AND step_key = 'generate_learning_content';
