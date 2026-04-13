
-- Disable all user triggers that could block the regression
ALTER TABLE public.package_steps DISABLE TRIGGER USER;

-- Reset all phantom-done governance steps on non-published packages
UPDATE public.package_steps ps
SET status = 'queued',
    meta = ps.meta 
      || jsonb_build_object(
           'allow_regression', true,
           'allow_regression_by', 'admin_manual',
           'reset_reason', 'phantom-done: governance step finalized without meta.ok=true',
           'reset_at', now()::text,
           'reset_by', 'forensic-phantom-done-audit-p0',
           'previous_status', 'done',
           'previous_ok', COALESCE(ps.meta->>'ok', 'null'),
           'previous_source', COALESCE(ps.meta->>'finalization_source', 'null')
         )
FROM course_packages cp
WHERE ps.package_id = cp.id
  AND ps.step_key IN ('run_integrity_check','quality_council','validate_exam_pool')
  AND ps.status = 'done'
  AND (ps.meta->>'ok' IS NULL OR ps.meta->>'ok' = 'false')
  AND cp.status NOT IN ('published');

-- Re-enable all user triggers
ALTER TABLE public.package_steps ENABLE TRIGGER USER;
