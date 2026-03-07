
-- =========================================================
-- FORENSIC FIX: Re-sync stuck lessons + mark done steps
-- =========================================================

-- 1) Re-fire sync trigger for MFA lesson (049eeb27) by touching the latest approved content_version
UPDATE public.content_versions
SET updated_at = now()
WHERE id = '0b0e8fad-a6b5-435b-8b18-dbabb0b3dea3'
  AND lesson_id = '049eeb27-72d8-44b4-80a9-cbc4846f81e6'
  AND status = 'approved';

-- 2) Re-fire sync trigger for Pharma lesson (0135f02c)
UPDATE public.content_versions
SET updated_at = now()
WHERE id = '69a1a780-ca89-446f-8902-fbb462cd70fe'
  AND lesson_id = '0135f02c-f71e-486f-9e85-455b1b4cd2b6'
  AND status = 'approved';

-- 3) Mark KFZ generate_learning_content step as done (needs_regen=0 confirmed)
UPDATE public.package_steps
SET status = 'done',
    finished_at = now(),
    updated_at = now(),
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'reason', 'needs_regen=0 (forensic-fix)',
      'forensic_fix_at', now()::text,
      'forensic_fix_reason', 'step_stuck_queued_but_needs_regen_0'
    )
WHERE package_id = '047bc325-5244-4f21-affd-5395bf62bcff'
  AND step_key = 'generate_learning_content'
  AND status = 'queued';

-- 4) Mark Sozialversicherung generate_learning_content step as done (needs_regen=0 confirmed)
UPDATE public.package_steps
SET status = 'done',
    finished_at = now(),
    updated_at = now(),
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'reason', 'needs_regen=0 (forensic-fix)',
      'forensic_fix_at', now()::text,
      'forensic_fix_reason', 'step_stuck_queued_but_needs_regen_0'
    )
WHERE package_id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  AND step_key = 'generate_learning_content'
  AND status = 'queued';

-- 5) Cancel the 98 stale failed dispatcher jobs (they'll be re-created fresh)
UPDATE public.job_queue
SET status = 'cancelled',
    completed_at = now(),
    updated_at = now(),
    last_error = '[FORENSIC_FIX] Stale dispatcher jobs cancelled after root-cause resolution'
WHERE job_type = 'package_generate_learning_content'
  AND status = 'failed';
