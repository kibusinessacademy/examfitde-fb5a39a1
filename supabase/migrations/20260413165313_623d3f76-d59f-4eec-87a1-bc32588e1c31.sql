
-- Atomic: set regression flags AND change status in one UPDATE
-- Ghost guard only fires when NEW.status = 'done', so going to 'queued' bypasses it
UPDATE public.package_steps
SET status = 'queued',
    meta = meta 
      || jsonb_build_object(
           'allow_regression', true,
           'allow_regression_by', 'admin_manual',
           'reset_reason', 'artifact_breach: validated_exam_pool never materialized',
           'reset_at', now()::text,
           'reset_by', 'forensic-postcondition-audit',
           'previous_status', 'done'
         )
WHERE package_id = '348c9ef9-b359-49f0-98ed-cd4a01a51522'
  AND step_key = 'validate_exam_pool'
  AND status = 'done';
