
-- Batch Elite Migration v2: Upgrade all EXAM_FIRST packages to AUSBILDUNG_VOLL
-- Uses LEFT JOIN to skip existing steps (avoids trigger conflict)

-- Step 1: Insert ONLY truly missing didaktik steps
INSERT INTO public.package_steps (package_id, step_key, status, meta)
SELECT cp.id, s.step_key, 'queued', '{"auto_created": true, "reason": "batch_elite_migration_v1"}'::jsonb
FROM course_packages cp
CROSS JOIN (VALUES 
  ('scaffold_learning_course'),
  ('generate_glossary'),
  ('generate_learning_content'),
  ('validate_learning_content'),
  ('generate_lesson_minichecks'),
  ('validate_lesson_minichecks'),
  ('generate_handbook'),
  ('validate_handbook'),
  ('elite_harden')
) AS s(step_key)
LEFT JOIN package_steps existing 
  ON existing.package_id = cp.id AND existing.step_key = s.step_key
WHERE cp.track = 'EXAM_FIRST'
  AND cp.status IN ('queued', 'building', 'quality_gate_failed', 'published', 'done')
  AND existing.id IS NULL;

-- Step 2: Reset quality gates to queued
UPDATE public.package_steps ps
SET status = 'queued', 
    meta = COALESCE(ps.meta, '{}'::jsonb) || '{"reset_reason": "batch_elite_migration_v1"}'::jsonb
FROM course_packages cp
WHERE ps.package_id = cp.id
  AND cp.track = 'EXAM_FIRST'
  AND cp.status IN ('queued', 'building', 'quality_gate_failed', 'published', 'done')
  AND ps.step_key IN ('run_integrity_check', 'quality_council', 'auto_publish');

-- Step 3: Update package track, flags, status
UPDATE public.course_packages
SET 
  track = 'AUSBILDUNG_VOLL',
  feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"has_learning_course": true, "has_minichecks": true, "has_handbook": true, "ai_tutor_mode": "full"}'::jsonb,
  status = CASE 
    WHEN status IN ('published', 'quality_gate_failed', 'done') THEN 'building'
    ELSE status
  END,
  build_progress = 0,
  updated_at = now()
WHERE track = 'EXAM_FIRST'
  AND status IN ('queued', 'building', 'quality_gate_failed', 'published', 'done');

-- Step 4: Clean generation locks
DELETE FROM public.course_generation_locks
WHERE course_id IN (
  SELECT cp.course_id FROM course_packages cp
  WHERE cp.track = 'AUSBILDUNG_VOLL' AND cp.updated_at > now() - interval '1 minute'
);

-- Step 5: Audit
INSERT INTO public.admin_actions (action, payload)
VALUES ('batch_elite_migration_v1', '{"description": "Batch upgrade EXAM_FIRST to AUSBILDUNG_VOLL", "scope": "304 active packages"}'::jsonb);
