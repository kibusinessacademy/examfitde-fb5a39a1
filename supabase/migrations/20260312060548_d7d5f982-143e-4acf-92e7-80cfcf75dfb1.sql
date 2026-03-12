
-- Fix 1: Büromanagement — identical deadlock as Verkäufer
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
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
AND step_key = 'generate_learning_content';

-- Fix 2: Elektroniker — partial counter drift (28 → 52)
UPDATE package_steps
SET meta = jsonb_set(
  jsonb_set(
    COALESCE(meta, '{}'::jsonb),
    '{needs_regen}', '52'
  ),
  '{meta_drift_fixed_at}', to_jsonb(now()::text)
),
    attempts = 0
WHERE package_id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
AND step_key = 'generate_learning_content';
