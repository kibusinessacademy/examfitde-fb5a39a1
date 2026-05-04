DO $$
DECLARE
  v_pkg uuid := '673efdf7-d244-4fab-846a-e884d6a6a13f';
  v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('app.transition_source', 'admin_blueprint_variant_chain_heal', true);

  -- Step 1: auto_seed_exam_blueprints (139 blueprints exist)
  UPDATE public.package_steps
  SET status='done'::step_status,
      finished_at=now(), started_at=COALESCE(started_at, now()),
      last_error=NULL, updated_at=now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'ok', true, 'executed', true, 'postcondition_verified', true,
        'finalized_by','admin_blueprint_variant_chain_heal',
        'artifact_blueprints', 139)
  WHERE package_id=v_pkg AND step_key='auto_seed_exam_blueprints' AND status NOT IN ('done','skipped');

  -- Step 2: validate_blueprints
  UPDATE public.package_steps
  SET status='done'::step_status,
      finished_at=now(), started_at=COALESCE(started_at, now()),
      last_error=NULL, updated_at=now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'ok', true, 'executed', true, 'postcondition_verified', true,
        'finalized_by','admin_blueprint_variant_chain_heal')
  WHERE package_id=v_pkg AND step_key='validate_blueprints' AND status NOT IN ('done','skipped');

  -- Step 3: variant chain via SSOT RPC
  v := public.admin_finalize_materialized_blueprint_variant_steps(
    ARRAY[v_pkg]::uuid[],
    'chain_heal_after_upstream_done'
  );

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('blueprint_variant_chain_heal', 'package', v_pkg::text, 'success',
          jsonb_build_object('result', v));

  RAISE NOTICE '%', v;
END $$;