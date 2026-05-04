DO $$
DECLARE
  v_pkg_ids uuid[];
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  SELECT ARRAY_AGG(DISTINCT package_id)
  INTO v_pkg_ids
  FROM public.package_steps
  WHERE step_key IN ('generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants')
    AND status NOT IN ('done','skipped');

  IF v_pkg_ids IS NULL THEN
    RAISE NOTICE 'no packages';
    RETURN;
  END IF;

  v_result := public.admin_finalize_materialized_blueprint_variant_steps(
    v_pkg_ids,
    'bulk_finalize_blueprint_variants_user_request'
  );

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'bulk_finalize_blueprint_variants',
    'system', NULL, 'success',
    jsonb_build_object('package_count', array_length(v_pkg_ids,1), 'result', v_result)
  );

  RAISE NOTICE 'result: %', v_result;
END $$;