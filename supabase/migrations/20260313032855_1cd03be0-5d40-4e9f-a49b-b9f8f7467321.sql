
-- Backfill missing handbook expansion steps for ALL packages that have validate_handbook but lack these steps
-- This fixes a systemic SSOT drift where 3 steps from the DAG were never seeded into package_steps

-- 1) enqueue_handbook_expand (depends on validate_handbook)
INSERT INTO public.package_steps (package_id, step_key, status, meta)
SELECT ps.package_id, 'enqueue_handbook_expand', 'queued', 
  '{"auto_created": true, "reason": "handbook_expand_backfill_v1"}'::jsonb
FROM public.package_steps ps
WHERE ps.step_key = 'validate_handbook'
  AND NOT EXISTS (
    SELECT 1 FROM public.package_steps ex 
    WHERE ex.package_id = ps.package_id AND ex.step_key = 'enqueue_handbook_expand'
  )
ON CONFLICT (package_id, step_key) DO NOTHING;

-- 2) expand_handbook (depends on enqueue_handbook_expand)
INSERT INTO public.package_steps (package_id, step_key, status, meta)
SELECT ps.package_id, 'expand_handbook', 'queued',
  '{"auto_created": true, "reason": "handbook_expand_backfill_v1"}'::jsonb
FROM public.package_steps ps
WHERE ps.step_key = 'validate_handbook'
  AND NOT EXISTS (
    SELECT 1 FROM public.package_steps ex
    WHERE ex.package_id = ps.package_id AND ex.step_key = 'expand_handbook'
  )
ON CONFLICT (package_id, step_key) DO NOTHING;

-- 3) validate_handbook_depth (depends on expand_handbook)
INSERT INTO public.package_steps (package_id, step_key, status, meta)
SELECT ps.package_id, 'validate_handbook_depth', 'queued',
  '{"auto_created": true, "reason": "handbook_expand_backfill_v1"}'::jsonb
FROM public.package_steps ps
WHERE ps.step_key = 'validate_handbook'
  AND NOT EXISTS (
    SELECT 1 FROM public.package_steps ex
    WHERE ex.package_id = ps.package_id AND ex.step_key = 'validate_handbook_depth'
  )
ON CONFLICT (package_id, step_key) DO NOTHING;
