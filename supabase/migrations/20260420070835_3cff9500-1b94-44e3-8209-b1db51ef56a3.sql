update package_steps
set status = 'queued', last_error = null, started_at = null, finished_at = null,
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'wave','15b_pilot_v3','reset_reason','hard_pin_gpt4o_mini_retry',
      'allow_regression', true, 'allow_regression_by','wave15b_hardpin','reset_at', now()
    ),
    updated_at = now()
where package_id = '3f416f2f-4364-460c-8924-caa2316a12d0'
  and step_key = 'auto_seed_exam_blueprints'
  and status = 'failed';