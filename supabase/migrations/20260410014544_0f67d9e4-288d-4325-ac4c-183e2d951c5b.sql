
-- Force-activate 3 Prio 1 packages (bypass WIP governance for manual admin activation)
UPDATE course_packages 
SET status = 'building', priority = 1, updated_at = now()
WHERE id IN (
  'eef4bbe6-6c92-4969-941e-af471e86d67f',
  '03462382-f62e-4be9-9940-013d42a4435b',
  '961103c5-74be-4357-8573-c73862cb09b2'
);

-- Ensure their first pipeline steps are queued
UPDATE package_steps 
SET status = 'queued', updated_at = now()
WHERE package_id IN (
  'eef4bbe6-6c92-4969-941e-af471e86d67f',
  '03462382-f62e-4be9-9940-013d42a4435b',
  '961103c5-74be-4357-8573-c73862cb09b2'
)
AND step_key = 'auto_seed_exam_blueprints'
AND status NOT IN ('done', 'skipped');
