
-- Need allow_regression for done→queued transitions
UPDATE package_steps
SET meta = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(COALESCE(meta, '{}'::jsonb), '{consecutive_no_progress}', '0'),
          '{gate_fix_reset_at}', to_jsonb(now()::text)
        ),
        '{allow_regression}', 'true'
      ),
      '{allow_regression_by}', '"admin_manual"'
    ),
    status = 'queued',
    updated_at = now()
WHERE step_key = 'validate_exam_pool'
  AND package_id IN (
    '259894ef-5d62-4692-bd21-a8250fe4b389',
    'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb',
    'eef4bbe6-6c92-4969-941e-af471e86d67f',
    '2e8da39f-60f8-44d9-8b70-e1176222ca55',
    '24c3793c-30b0-43a7-bd5d-cfed0c40542d',
    '2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2',
    '96d0fb31-9951-408d-a83e-b2937f5a6af8',
    'fdf4c23c-be16-43ed-ac0e-aea0ab64665f'
  );
