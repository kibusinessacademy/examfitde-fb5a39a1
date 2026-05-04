DO $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v := public.admin_finalize_materialized_blueprint_variant_steps(
    ARRAY['673efdf7-d244-4fab-846a-e884d6a6a13f']::uuid[],
    'bulk_finalize_blueprint_variants_user_request_round2'
  );
  RAISE NOTICE '%', v;
END $$;