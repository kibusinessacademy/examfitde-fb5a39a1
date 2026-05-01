
CREATE OR REPLACE FUNCTION public.admin_seed_missing_product_prices(p_apply boolean DEFAULT false)
RETURNS TABLE (
  package_id uuid,
  package_title text,
  product_id uuid,
  product_title text,
  product_status text,
  suggested_tier text,
  suggested_amount_cents integer,
  classifier_confidence text,
  classifier_reason text,
  mapped_stripe_price_id text,
  tier_label text,
  action text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_unmapped_count int;
  v_inserted_id uuid;
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  -- Build candidate set (all published packages with product_id, no active price)
  CREATE TEMP TABLE _seed_candidates ON COMMIT DROP AS
  SELECT
    cp.id                             AS package_id,
    cp.title                          AS package_title,
    cp.product_id                     AS product_id,
    pr.title                          AS product_title,
    pr.status                         AS product_status,
    cls.tier_key                      AS suggested_tier,
    cls.price_cents::int              AS suggested_amount_cents,
    cls.confidence                    AS classifier_confidence,
    cls.reason                        AS classifier_reason,
    m.stripe_price_id                 AS mapped_stripe_price_id,
    m.tier_label                      AS tier_label
  FROM public.course_packages cp
  JOIN public.products pr ON pr.id = cp.product_id
  LEFT JOIN LATERAL public.classify_package_pricing_tier(cp.title)
    AS cls(tier_key, price_cents, confidence, reason) ON true
  LEFT JOIN public.pricing_tier_stripe_map m
    ON m.amount_cents = cls.price_cents
   AND m.currency = 'eur'
   AND m.billing_type = 'one_time'
   AND m.is_active = true
  WHERE cp.status = 'published'
    AND cp.product_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.product_prices pp
      WHERE pp.product_id = cp.product_id AND pp.active = true
    );

  -- Apply gate: every suggested amount must have a mapped stripe_price_id
  IF p_apply THEN
    SELECT COUNT(*)::int INTO v_unmapped_count
    FROM _seed_candidates
    WHERE mapped_stripe_price_id IS NULL;

    IF v_unmapped_count > 0 THEN
      RAISE EXCEPTION
        'apply blocked: % candidate(s) have no active pricing_tier_stripe_map entry', v_unmapped_count;
    END IF;
  END IF;

  -- PREVIEW path
  IF NOT p_apply THEN
    RETURN QUERY
    SELECT c.package_id, c.package_title, c.product_id, c.product_title, c.product_status,
           c.suggested_tier, c.suggested_amount_cents,
           c.classifier_confidence, c.classifier_reason,
           c.mapped_stripe_price_id, c.tier_label,
           CASE
             WHEN c.mapped_stripe_price_id IS NULL THEN 'preview_blocked_no_tier_map'
             ELSE 'preview_ready_to_seed'
           END AS action,
           CASE
             WHEN c.mapped_stripe_price_id IS NULL
               THEN 'no active pricing_tier_stripe_map for amount/currency/billing_type'
             ELSE 'classifier suggestion mapped to existing Stripe tier price'
           END AS reason
    FROM _seed_candidates c
    ORDER BY c.package_title;
    RETURN;
  END IF;

  -- APPLY path: idempotent insert per candidate + audit
  RETURN QUERY
  WITH ins AS (
    INSERT INTO public.product_prices (
      product_id, currency, amount_cents, billing_type, access_months,
      active, stripe_price_id
    )
    SELECT
      c.product_id, 'EUR', c.suggested_amount_cents, 'one_time', 12,
      true, c.mapped_stripe_price_id
    FROM _seed_candidates c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.product_prices pp
      WHERE pp.product_id = c.product_id AND pp.active = true
    )
    RETURNING id, product_id, amount_cents, stripe_price_id
  ),
  audited AS (
    INSERT INTO public.stripe_price_sync_audit (
      product_price_id, action, before_stripe_price_id, after_stripe_price_id,
      amount_cents, currency, reason, metadata, triggered_by, trigger_source
    )
    SELECT
      i.id, 'seed_missing_price', NULL, i.stripe_price_id,
      i.amount_cents, 'eur',
      'admin_seed_missing_product_prices apply',
      jsonb_build_object('product_id', i.product_id),
      v_caller, 'admin_rpc'
    FROM ins i
    RETURNING product_price_id
  )
  SELECT
    c.package_id, c.package_title, c.product_id, c.product_title, c.product_status,
    c.suggested_tier, c.suggested_amount_cents,
    c.classifier_confidence, c.classifier_reason,
    c.mapped_stripe_price_id, c.tier_label,
    CASE WHEN i.id IS NOT NULL THEN 'applied_inserted' ELSE 'applied_noop_already_exists' END AS action,
    CASE WHEN i.id IS NOT NULL
         THEN 'inserted product_prices row + audit'
         ELSE 'active price appeared concurrently — skipped'
    END AS reason
  FROM _seed_candidates c
  LEFT JOIN ins i ON i.product_id = c.product_id
  ORDER BY c.package_title;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_seed_missing_product_prices(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seed_missing_product_prices(boolean) TO service_role;

COMMENT ON FUNCTION public.admin_seed_missing_product_prices(boolean) IS
'Admin-RPC: Seed fehlender product_prices für published Pakete. Preview by default. Apply nur wenn alle Tiers in pricing_tier_stripe_map gemappt. Keine Produkt-/Stripe-Anlage. Nutzt classify_package_pricing_tier als SSOT.';
