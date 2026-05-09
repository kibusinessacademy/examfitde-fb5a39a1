
UPDATE public.package_steps
SET 
  exception_approved = true,
  status = 'done'::step_status,
  finished_at = now(),
  started_at = COALESCE(started_at, now()),
  last_error = NULL,
  meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
    'ok', true,
    'emergency_bypass', true,
    'seed_bypass', true,
    'bypass_reason', 'manual_seed_completion_after_coverage_verified',
    'bypassed_at', now(),
    'bypassed_by', 'admin_oral_seed_finalize'
  )
WHERE package_id = '5d74dcbf-8ae7-4c82-b181-09e23f02dd2c'
  AND step_key = 'generate_oral_exam';

INSERT INTO public.auto_heal_log(action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
VALUES (
  'manual_sustainable_heal_v1', 'package', '5d74dcbf-8ae7-4c82-b181-09e23f02dd2c',
  'admin_oral_seed_finalize', 'success',
  'Marked generate_oral_exam=done with exception_approved bypass after seed produced 43 oral_exam_blueprints (42/42 competencies covered)',
  jsonb_build_object('package','Bürsten- und Pinselmacher/-in','oral_bps',43,'comps_covered','42/42')
);
