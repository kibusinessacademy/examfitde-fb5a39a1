UPDATE package_steps
SET 
  status = 'queued',
  started_at = NULL,
  finished_at = NULL,
  last_error = NULL,
  updated_at = NOW(),
  meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
    'healed_true_stall', true,
    'healed_at', NOW()::text,
    'heal_reason', 'TRUE_STALL: gen+fin=done but validate stuck >14d'
  )
WHERE step_key = 'validate_learning_content'
  AND status = 'queued'
  AND package_id IN (
    '70f0a909-2d44-4b8b-97a3-0aa9679b3704',
    '01099a37-3309-4bc1-a2ce-6a6913e4d125',
    '022eb5fc-281a-4764-928f-a3c77a6f8997',
    '65c74607-9f65-4b21-8fb9-a8c7f3aa3d92',
    '9c1b3734-bb25-4986-baef-5bb1c20a212c'
  )