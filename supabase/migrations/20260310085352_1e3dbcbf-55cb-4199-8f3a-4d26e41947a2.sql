
-- Reset the handbook job to run immediately with the new Flash-first code
UPDATE job_queue
SET run_after = now(),
    last_error = 'provider_rotation_fix_v9: flash-first strategy deployed',
    meta = jsonb_set(
      COALESCE(meta, '{}'::jsonb),
      '{attempt_index}',
      '0'
    ),
    updated_at = now()
WHERE id = '0639aaab-484b-43f8-97d7-8eb49b0ec8c3'
  AND status = 'pending';
