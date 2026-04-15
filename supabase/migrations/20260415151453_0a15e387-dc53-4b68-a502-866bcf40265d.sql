
UPDATE package_steps
SET meta = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(meta, '{guard_state}', '"recovering"'),
      '{stall_reason_code}', 'null'
    ),
    '{consecutive_no_progress}', '0'
  ),
  '{gate_status}', '"REPAIRABLE"'
),
updated_at = now()
WHERE package_id IN (
  '348c9ef9-b359-49f0-98ed-cd4a01a51522',
  '2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2'
)
AND step_key = 'validate_exam_pool';
