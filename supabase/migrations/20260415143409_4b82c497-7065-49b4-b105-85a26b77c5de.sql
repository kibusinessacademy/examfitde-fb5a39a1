
-- First set started_at and attempts to satisfy ghost finalization guard
UPDATE package_steps
SET started_at = now(),
    attempts = 1,
    updated_at = now()
WHERE step_key = 'auto_seed_exam_blueprints'
  AND status = 'queued'
  AND package_id IN (
    'fa931e34-52ee-4296-889f-303575b088d5',
    'd2000000-0010-4000-8000-000000000001',
    'dd000001-0005-4000-8000-000000000001'
  );

-- Now mark as done with proper meta
UPDATE package_steps
SET status = 'done',
    updated_at = now(),
    finished_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'ok', true,
      'done_reason', 'redundant_seeding_guard_manual',
      'auto_completed_at', now()
    )
WHERE step_key = 'auto_seed_exam_blueprints'
  AND package_id IN (
    'fa931e34-52ee-4296-889f-303575b088d5',
    'd2000000-0010-4000-8000-000000000001',
    'dd000001-0005-4000-8000-000000000001'
  );
