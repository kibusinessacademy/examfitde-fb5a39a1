-- 1) Audit contract entries (Pfad C)
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module) VALUES
  ('deprecated_smoke_mode_called', ARRAY['legacy_mode','canonical_mode','correlation_id']::text[], 'naming-migration-c'),
  ('naming_assert_passed',         ARRAY['scope','asserted']::text[],                              'naming-migration-c'),
  ('naming_assert_failure',        ARRAY['scope','reason']::text[],                                 'naming-migration-c')
ON CONFLICT (action_type) DO NOTHING;

-- 2) Cleanup RPC: scoped strictly by correlation_id tagged into billing_email
--    Pattern: smoke+<corr8>@examfit-smoke.local OR stripe_checkout_session_id LIKE '%<corrId>%'
CREATE OR REPLACE FUNCTION public._smoke_cleanup_by_correlation(_correlation_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ids uuid[];
  _corr_short text := substr(_correlation_id, 1, 8);
  _email_pattern text := 'smoke+' || _corr_short || '@examfit-smoke.local';
  _session_pattern text := '%' || _correlation_id || '%';
  _removed_orders int := 0;
BEGIN
  IF _correlation_id IS NULL OR length(_correlation_id) < 8 THEN
    RAISE EXCEPTION 'correlation_id must be at least 8 chars';
  END IF;

  -- Discover smoke orders by correlation tag (email OR stripe session)
  SELECT array_agg(id) INTO _ids
  FROM public.orders
  WHERE billing_email = _email_pattern
     OR stripe_checkout_session_id LIKE _session_pattern;

  IF _ids IS NULL OR cardinality(_ids) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'removed_count', 0, 'correlation_id', _correlation_id);
  END IF;

  -- Delegate to existing _smoke_cleanup_orders for cascade (ledger/payments/invoices/items)
  PERFORM public._smoke_cleanup_orders(_ids);
  _removed_orders := cardinality(_ids);

  RETURN jsonb_build_object(
    'ok', true,
    'removed_count', _removed_orders,
    'correlation_id', _correlation_id,
    'order_ids', to_jsonb(_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._smoke_cleanup_by_correlation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._smoke_cleanup_by_correlation(text) TO service_role;

COMMENT ON FUNCTION public._smoke_cleanup_by_correlation(text) IS
  'Pfad C: deletes smoke orders tagged with billing_email=smoke+<corr8>@examfit-smoke.local '
  'or stripe_checkout_session_id LIKE %<corrId>%. Delegates to _smoke_cleanup_orders for cascade.';