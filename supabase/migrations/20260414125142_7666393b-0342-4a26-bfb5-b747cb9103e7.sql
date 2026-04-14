
-- Reset phantom-pass generate_lesson_minichecks with regression guard bypass
UPDATE package_steps
SET status = 'queued',
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'allow_regression', true,
      'allow_regression_by', 'admin_manual',
      'reset_reason', 'phantom_pass_no_minichecks_materialized',
      'reset_at', now()::text,
      'reset_source', 'admin_manual',
      'prev_bypass_reason', meta->>'bypass_reason'
    ),
    updated_at = now()
WHERE package_id = '348c9ef9-b359-49f0-98ed-cd4a01a51522'
  AND step_key = 'generate_lesson_minichecks'
  AND status = 'done';

-- Cancel orphaned validate jobs
UPDATE job_queue
SET status = 'cancelled',
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'upstream_generate_reset',
      'transition_source', 'admin_manual'
    ),
    updated_at = now()
WHERE job_type = 'package_validate_lesson_minichecks'
  AND package_id = '348c9ef9-b359-49f0-98ed-cd4a01a51522'
  AND status IN ('pending', 'processing');
