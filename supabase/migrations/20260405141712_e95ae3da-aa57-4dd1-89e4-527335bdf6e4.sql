
-- 1. Insert missing variant steps (idempotent - steps from prev migration already applied)
INSERT INTO package_steps (package_id, step_key, status, meta)
SELECT cp.id, s.step_key, 'queued'::step_status, '{}'::jsonb
FROM course_packages cp
CROSS JOIN (VALUES 
  ('generate_blueprint_variants'),
  ('validate_blueprint_variants'),
  ('promote_blueprint_variants')
) AS s(step_key)
WHERE cp.status = 'building'
AND NOT EXISTS (
  SELECT 1 FROM package_steps ps 
  WHERE ps.package_id = cp.id AND ps.step_key = s.step_key
)
ON CONFLICT DO NOTHING;

-- 2. Reset transient-exhausted failed jobs ONLY if no pending duplicate exists
UPDATE job_queue jq
SET status = 'pending',
    run_after = now() + interval '30 seconds',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now(),
    meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
      'reset_reason', 'variant_steps_backfilled',
      'reset_at', now()::text,
      'transient_exhausted', false
    )
WHERE jq.status = 'failed'
  AND jq.meta->>'transient_exhausted' = 'true'
  AND jq.package_id IN (SELECT id FROM course_packages WHERE status = 'building')
  AND NOT EXISTS (
    SELECT 1 FROM job_queue dup
    WHERE dup.package_id = jq.package_id
      AND dup.job_type = jq.job_type
      AND dup.status IN ('pending', 'processing')
      AND dup.id != jq.id
  );

-- 3. Cancel garbage jobs for non-building packages
UPDATE job_queue
SET status = 'cancelled',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'cancelled_reason', 'package_not_building',
      'cancelled_at', now()::text
    )
WHERE status IN ('pending', 'failed')
  AND package_id IN (
    SELECT cp.id FROM course_packages cp 
    WHERE cp.status NOT IN ('building')
    AND cp.id IN (SELECT DISTINCT package_id FROM job_queue WHERE status IN ('pending', 'failed') AND package_id IS NOT NULL)
  );

-- 4. Notification
INSERT INTO admin_notifications (title, body, severity, category)
VALUES (
  'Pipeline-Reparatur: Varianten-Steps nachgetragen',
  '13 Pakete fehlten die Blueprint-Varianten-Steps (generate/validate/promote_blueprint_variants). Nachgetragen, blockierte Jobs zurückgesetzt, Müll-Jobs storniert.',
  'warning',
  'pipeline'
);
