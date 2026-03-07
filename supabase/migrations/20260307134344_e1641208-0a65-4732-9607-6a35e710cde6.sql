
-- Fix Spedition step (same pattern as KFZ/Sozialversicherung)
UPDATE public.package_steps
SET status = 'done',
    finished_at = now(),
    updated_at = now(),
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'reason', 'needs_regen=0 (forensic-fix)',
      'forensic_fix_at', now()::text
    )
WHERE package_id = '259894ef-5d62-4692-bd21-a8250fe4b389'
  AND step_key = 'generate_learning_content'
  AND status = 'queued';
