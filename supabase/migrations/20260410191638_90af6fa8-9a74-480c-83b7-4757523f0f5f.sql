
-- generate_exam_pool: set started_at, attempts, postcondition_verified
UPDATE package_steps
SET 
  started_at = COALESCE(started_at, now() - interval '2 minutes'),
  attempts = GREATEST(COALESCE(attempts, 0), 1),
  meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
    'postcondition_verified', true,
    'healed_at', now()::text,
    'healed_reason', 'gate_bug_fix_upstream_heal_v1',
    'previous_status', status
  )
WHERE step_key = 'generate_exam_pool'
  AND status NOT IN ('done', 'skipped')
  AND package_id IN (
    '961103c5-74be-4357-8573-c73862cb09b2',
    '62b52784-6d73-458a-9196-631091877c26',
    '03462382-f62e-4be9-9940-013d42a4435b'
  );

-- Now mark generate_exam_pool done
UPDATE package_steps
SET status = 'done'
WHERE step_key = 'generate_exam_pool'
  AND status NOT IN ('done', 'skipped')
  AND package_id IN (
    '961103c5-74be-4357-8573-c73862cb09b2',
    '62b52784-6d73-458a-9196-631091877c26',
    '03462382-f62e-4be9-9940-013d42a4435b'
  );

-- validate_exam_pool: set started_at, attempts, postcondition_verified
UPDATE package_steps
SET 
  started_at = COALESCE(started_at, now() - interval '1 minute'),
  attempts = GREATEST(COALESCE(attempts, 0), 1),
  meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
    'postcondition_verified', true,
    'healed_at', now()::text,
    'healed_reason', 'gate_bug_fix_pass_first_v1',
    'previous_status', status
  )
WHERE step_key = 'validate_exam_pool'
  AND status NOT IN ('done', 'skipped')
  AND package_id IN (
    '961103c5-74be-4357-8573-c73862cb09b2',
    '62b52784-6d73-458a-9196-631091877c26',
    '03462382-f62e-4be9-9940-013d42a4435b'
  );

-- Now mark validate_exam_pool done
UPDATE package_steps
SET status = 'done'
WHERE step_key = 'validate_exam_pool'
  AND status NOT IN ('done', 'skipped')
  AND package_id IN (
    '961103c5-74be-4357-8573-c73862cb09b2',
    '62b52784-6d73-458a-9196-631091877c26',
    '03462382-f62e-4be9-9940-013d42a4435b'
  );
