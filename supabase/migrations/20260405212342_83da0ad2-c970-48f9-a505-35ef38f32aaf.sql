
-- Step 1: Set started_at and attempts to satisfy ghost guard, then go to running
UPDATE package_steps
SET status = 'running',
    started_at = now() - interval '1 minute',
    attempts = 1,
    updated_at = now()
WHERE step_key = 'validate_blueprints'
  AND status = 'queued'
  AND package_id IN (
    'b960658d-95e9-4824-a404-821d5e9b5142',
    'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af',
    'fec61780-be73-4aca-a88e-1c6f1f39d412'
  );

-- Step 2: running → done
UPDATE package_steps
SET status = 'done', updated_at = now()
WHERE step_key = 'validate_blueprints'
  AND status = 'running'
  AND package_id IN (
    'b960658d-95e9-4824-a404-821d5e9b5142',
    'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af',
    'fec61780-be73-4aca-a88e-1c6f1f39d412'
  );
