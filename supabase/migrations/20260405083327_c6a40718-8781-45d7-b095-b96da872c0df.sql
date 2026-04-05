
-- Fix 1: Create the missing certification (already created by previous partial migration)
INSERT INTO public.certifications (id, title, slug, certification_type, track, validation_profile, active)
VALUES (
  'c3000000-0004-4000-8000-000000000001',
  'Wirtschaftsinformatik Bachelor',
  'wirtschaftsinformatik-bachelor',
  'studium',
  'STUDIUM',
  'CERT_ACADEMIC',
  true
)
ON CONFLICT (id) DO NOTHING;

-- Fix 2: Link curriculum (may already be done)
UPDATE public.curricula
SET certification_id = 'c3000000-0004-4000-8000-000000000001'
WHERE id = 'c2000000-0004-4000-8000-000000000001'
  AND certification_id IS NULL;

-- Fix 3: Reset steps with regression guard bypass
UPDATE public.package_steps
SET status = 'queued',
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"allow_regression": true, "allow_regression_by": "admin_manual"}'::jsonb,
    updated_at = now()
WHERE package_id = 'c5000000-0004-4000-8000-000000000001'
  AND step_key IN ('auto_seed_exam_blueprints', 'validate_blueprints', 'generate_blueprint_variants')
  AND status = 'done'
  AND last_error LIKE '%cancelled%';

-- Fix 4: Cancel stale jobs
UPDATE public.job_queue
SET status = 'cancelled',
    last_error = 'RESET: step reset due to FK break fix',
    updated_at = now()
WHERE package_id = 'c5000000-0004-4000-8000-000000000001'
  AND job_type IN ('package_auto_seed_exam_blueprints', 'package_validate_blueprints', 'package_generate_blueprint_variants')
  AND status IN ('pending', 'running', 'failed');
