
CREATE OR REPLACE FUNCTION public.admin_pricing_backfill_apply(
  p_package_ids uuid[],
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE (
  package_id uuid,
  package_title text,
  action text,
  price_id uuid,
  amount_cents integer,
  tier_key text,
  status text,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_new_price_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  IF p_package_ids IS NULL OR array_length(p_package_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_package_ids must be a non-empty array';
  END IF;

  FOR v_row IN
    SELECT v.*
    FROM v_pricing_backfill_dryrun v
    WHERE v.package_id = ANY(p_package_ids)
  LOOP
    -- Eligibility gate
    IF v_row.action_needed <> 'create_price_only' THEN
      RETURN QUERY SELECT
        v_row.package_id, v_row.package_title, v_row.action_needed,
        NULL::uuid, NULL::integer, v_row.suggested_tier,
        'skipped'::text,
        format('action_needed=%s — only create_price_only is supported by this RPC', v_row.action_needed);
      CONTINUE;
    END IF;

    IF v_row.existing_product_id IS NULL THEN
      RETURN QUERY SELECT v_row.package_id, v_row.package_title, v_row.action_needed,
        NULL::uuid, NULL::integer, v_row.suggested_tier, 'skipped'::text,
        'no existing product (would need create_product_and_price)';
      CONTINUE;
    END IF;

    -- Idempotency
    IF EXISTS (SELECT 1 FROM product_prices pp WHERE pp.product_id = v_row.existing_product_id AND pp.active = true) THEN
      RETURN QUERY SELECT v_row.package_id, v_row.package_title, v_row.action_needed,
        NULL::uuid, NULL::integer, v_row.suggested_tier, 'skipped'::text,
        'product already has an active price';
      CONTINUE;
    END IF;

    IF v_row.suggested_price_cents IS NULL OR v_row.suggested_tier IS NULL THEN
      RETURN QUERY SELECT v_row.package_id, v_row.package_title, v_row.action_needed,
        NULL::uuid, NULL::integer, v_row.suggested_tier, 'skipped'::text,
        'no suggested tier/price (manual review)';
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      RETURN QUERY SELECT v_row.package_id, v_row.package_title, 'create_price_only'::text,
        NULL::uuid, v_row.suggested_price_cents, v_row.suggested_tier,
        'dry_run'::text,
        format('would insert price %s cents (tier %s) on product %s', v_row.suggested_price_cents, v_row.suggested_tier, v_row.existing_product_id);
      CONTINUE;
    END IF;

    -- APPLY
    INSERT INTO product_prices (product_id, currency, amount_cents, billing_type, access_months, active)
    VALUES (v_row.existing_product_id, 'eur', v_row.suggested_price_cents, 'one_time', 12, true)
    RETURNING id INTO v_new_price_id;

    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, metadata)
    VALUES (
      'pricing_backfill_create_price', 'pricing_audit_v1', 'product_price', v_new_price_id::text, 'success',
      jsonb_build_object(
        'package_id', v_row.package_id,
        'package_title', v_row.package_title,
        'product_id', v_row.existing_product_id,
        'tier_key', v_row.suggested_tier,
        'amount_cents', v_row.suggested_price_cents,
        'confidence', v_row.confidence,
        'reason', v_row.reason
      )
    );

    RETURN QUERY SELECT v_row.package_id, v_row.package_title, 'create_price_only'::text,
      v_new_price_id, v_row.suggested_price_cents, v_row.suggested_tier,
      'applied'::text,
      format('inserted price %s on product %s', v_new_price_id, v_row.existing_product_id);
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION public.admin_pricing_backfill_apply(uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_pricing_backfill_apply(uuid[], boolean) TO authenticated;
