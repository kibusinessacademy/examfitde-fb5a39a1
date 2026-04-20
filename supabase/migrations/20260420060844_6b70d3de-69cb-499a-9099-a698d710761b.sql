UPDATE public.package_steps ps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    updated_at = now(),
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'wave', 15,
      'reset_reason', 'wave15a_hollow_done_correction_bb_junk_blueprints',
      'allow_regression', true,
      'allow_regression_by', 'ops_force_reset',
      'reset_at', now()
    )
WHERE ps.package_id = '3f416f2f-4364-460c-8924-caa2316a12d0'
  AND ps.step_key IN ('auto_seed_exam_blueprints','validate_blueprints','generate_blueprint_variants')
  AND ps.status = 'done';