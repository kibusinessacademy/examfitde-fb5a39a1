DROP FUNCTION IF EXISTS public.admin_pricing_backfill_apply(uuid[], boolean);
DROP FUNCTION IF EXISTS public.admin_pricing_backfill_apply(boolean, text[], text[], text[]);

CREATE OR REPLACE FUNCTION public.admin_pricing_backfill_apply(
  p_dry_run boolean DEFAULT true,
  p_confidence text[] DEFAULT ARRAY['high']::text[],
  p_actions text[] DEFAULT ARRAY['create_price_only']::text[],
  p_tiers text[] DEFAULT NULL
)
RETURNS TABLE(
  package_id uuid,
  package_title text,
  existing_product_id uuid,
  suggested_tier text,
  suggested_price_cents integer,
  confidence text,
  action_needed text,
  would_create_price boolean,
  applied boolean,
  skip_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_already_active boolean;
  v_new_price_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  FOR v_rec IN
    SELECT v.*
    FROM public.v_pricing_backfill_dryrun v
    WHERE v.confidence = ANY(p_confidence)
      AND v.action_needed = ANY(p_actions)
      AND (p_tiers IS NULL OR v.suggested_tier = ANY(p_tiers))
  LOOP
    package_id              := v_rec.package_id;
    package_title           := v_rec.package_title;
    existing_product_id     := v_rec.existing_product_id;
    suggested_tier          := v_rec.suggested_tier;
    suggested_price_cents   := v_rec.suggested_price_cents;
    confidence              := v_rec.confidence;
    action_needed           := v_rec.action_needed;
    would_create_price      := (v_rec.action_needed = 'create_price_only'
                                AND v_rec.existing_product_id IS NOT NULL
                                AND v_rec.suggested_price_cents IS NOT NULL);
    applied                 := false;
    skip_reason             := NULL;

    IF NOT would_create_price THEN
      skip_reason := 'not_eligible_for_create_price_only';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Idempotency: skip if any active price already exists
    SELECT EXISTS (
      SELECT 1 FROM public.product_prices pp
      WHERE pp.product_id = v_rec.existing_product_id AND pp.active = true
    ) INTO v_already_active;

    IF v_already_active THEN
      skip_reason := 'active_price_already_exists';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      skip_reason := 'dry_run';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Apply
    INSERT INTO public.product_prices (
      product_id, currency, amount_cents, billing_type, access_months, active
    ) VALUES (
      v_rec.existing_product_id, 'eur', v_rec.suggested_price_cents, 'one_time', 12, true
    )
    RETURNING id INTO v_new_price_id;

    INSERT INTO public.auto_heal_log (
      action_type, target_type, target_id, result_status, result_detail,
      trigger_source, metadata
    ) VALUES (
      'pricing_backfill_create_price', 'product', v_rec.existing_product_id,
      'success',
      format('Created price %s cents (tier=%s, confidence=%s)',
             v_rec.suggested_price_cents, v_rec.suggested_tier, v_rec.confidence),
      'admin_pricing_backfill_apply',
      jsonb_build_object(
        'package_id', v_rec.package_id,
        'package_title', v_rec.package_title,
        'price_id', v_new_price_id,
        'tier', v_rec.suggested_tier,
        'amount_cents', v_rec.suggested_price_cents,
        'confidence', v_rec.confidence
      )
    );

    applied := true;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_pricing_backfill_apply(boolean, text[], text[], text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pricing_backfill_apply(boolean, text[], text[], text[]) TO authenticated;

COMMENT ON FUNCTION public.admin_pricing_backfill_apply(boolean, text[], text[], text[]) IS
'Pricing-Backfill Apply: filtert v_pricing_backfill_dryrun nach confidence/actions/tiers, idempotent (skip wenn aktiver Preis), Default Dry-Run.';