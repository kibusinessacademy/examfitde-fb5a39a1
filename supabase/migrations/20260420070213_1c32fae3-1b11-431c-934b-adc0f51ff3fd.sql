update package_steps
set status = 'queued',
    last_error = null,
    started_at = null,
    finished_at = null,
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'wave', '15b_pilot_v2',
      'reset_reason', 'provider_retry_fix',
      'allow_regression', true,
      'allow_regression_by', 'wave15b_provider_fix',
      'reset_at', now()
    ),
    updated_at = now()
where package_id = '3f416f2f-4364-460c-8924-caa2316a12d0'
  and step_key = 'auto_seed_exam_blueprints'
  and status = 'failed';

insert into admin_actions (action, scope, payload, affected_ids)
values ('wave_15b_pilot_v2_reset', 'package', jsonb_build_object(
  'package_id','3f416f2f-4364-460c-8924-caa2316a12d0',
  'reason','provider_retry_pinned_to_openai_chain',
  'wave','15b_pilot_v2'
), array['3f416f2f-4364-460c-8924-caa2316a12d0']);