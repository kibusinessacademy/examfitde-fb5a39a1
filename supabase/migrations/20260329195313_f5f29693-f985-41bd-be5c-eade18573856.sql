
-- =============================================================
-- Dual-Engine Hardening: 4 Fixes
-- =============================================================

-- ── FIX 1: org_licenses — partial unique index (one active per org+product) ──
-- Replace the blanket btree index with a proper constraint
DROP INDEX IF EXISTS idx_org_licenses_org_product;
CREATE UNIQUE INDEX uq_org_licenses_active_per_product
  ON public.org_licenses (org_id, product_id)
  WHERE status = 'active';

-- ── FIX 2: Seat assignment table + hardened check_org_license_access ──
-- Create org_license_seats to track which user occupies which seat
CREATE TABLE IF NOT EXISTS public.org_license_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id uuid NOT NULL REFERENCES public.org_licenses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  UNIQUE(license_id, user_id)
);

ALTER TABLE public.org_license_seats ENABLE ROW LEVEL SECURITY;

-- Org admins/owners can manage seats in their org
CREATE POLICY "Org admins manage seats"
  ON public.org_license_seats FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_licenses ol
      JOIN public.org_memberships om ON om.org_id = ol.org_id
      WHERE ol.id = org_license_seats.license_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role IN ('owner','admin','manager')
        AND om.status = 'active'
    )
  );

-- Users can see their own seat
CREATE POLICY "Users see own seats"
  ON public.org_license_seats FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Trigger to keep seats_used in sync
CREATE OR REPLACE FUNCTION public.sync_org_license_seats_used()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.org_licenses
  SET seats_used = (
    SELECT count(*) FROM public.org_license_seats
    WHERE license_id = COALESCE(NEW.license_id, OLD.license_id)
      AND released_at IS NULL
  )
  WHERE id = COALESCE(NEW.license_id, OLD.license_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_sync_seats_used
  AFTER INSERT OR UPDATE OR DELETE ON public.org_license_seats
  FOR EACH ROW EXECUTE FUNCTION public.sync_org_license_seats_used();

-- Hardened check: user must have an actual seat, not just "seats available"
CREATE OR REPLACE FUNCTION public.check_org_license_access(
  p_user_id uuid,
  p_product_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_license_seats ols
    JOIN public.org_licenses ol ON ol.id = ols.license_id
    WHERE ols.user_id = p_user_id
      AND ols.released_at IS NULL
      AND ol.product_id = p_product_id
      AND ol.status = 'active'
      AND (ol.ends_at IS NULL OR ol.ends_at > now())
  );
$$;

REVOKE ALL ON FUNCTION public.check_org_license_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_org_license_access(uuid, uuid) TO service_role;

-- ── FIX 3: Channel-specific pricing on paywall_variants ──
-- Add per-channel price columns so price_cents is display-only
ALTER TABLE public.paywall_variants
  ADD COLUMN IF NOT EXISTS web_price_cents integer,
  ADD COLUMN IF NOT EXISTS ios_price_cents integer,
  ADD COLUMN IF NOT EXISTS android_price_cents integer;

COMMENT ON COLUMN public.paywall_variants.price_cents IS 'Display/experiment price — actual charge comes from channel-specific column or SKU';
COMMENT ON COLUMN public.paywall_variants.web_price_cents IS 'Actual Stripe charge in cents (if different from display price)';
COMMENT ON COLUMN public.paywall_variants.ios_price_cents IS 'Actual Apple IAP price in cents (may differ due to App Store tiers)';
COMMENT ON COLUMN public.paywall_variants.android_price_cents IS 'Actual Google Play price in cents';

-- ── FIX 4: Race-safe assign_paywall_variant ──
-- After ON CONFLICT DO NOTHING, re-read the actual stored assignment
CREATE OR REPLACE FUNCTION public.assign_paywall_variant(
  p_user_id uuid,
  p_experiment_key text,
  p_platform text DEFAULT 'web'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_experiment record;
  v_existing record;
  v_variant record;
  v_rand float;
  v_cumulative float := 0;
  v_total_weight integer;
  v_actual_assignment record;
BEGIN
  SELECT * INTO v_experiment
  FROM public.paywall_experiments
  WHERE experiment_key = p_experiment_key AND status = 'active'
  LIMIT 1;

  IF v_experiment IS NULL THEN
    RETURN jsonb_build_object('error', 'experiment_not_found');
  END IF;

  -- Check existing (sticky assignment)
  SELECT ea.*, pv.variant_key, pv.price_cents, pv.currency,
         pv.layout, pv.trigger_context, pv.urgency_type,
         pv.headline, pv.subheadline, pv.cta_text,
         pv.features_json, pv.stripe_price_id,
         pv.apple_sku, pv.google_sku, pv.is_control,
         pv.web_price_cents, pv.ios_price_cents, pv.android_price_cents
  INTO v_existing
  FROM public.experiment_assignments ea
  JOIN public.paywall_variants pv ON pv.id = ea.variant_id
  WHERE ea.user_id = p_user_id AND ea.experiment_id = v_experiment.id;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'variant_key', v_existing.variant_key,
      'price_cents', v_existing.price_cents,
      'currency', v_existing.currency,
      'layout', v_existing.layout,
      'trigger_context', v_existing.trigger_context,
      'urgency_type', v_existing.urgency_type,
      'headline', v_existing.headline,
      'subheadline', v_existing.subheadline,
      'cta_text', v_existing.cta_text,
      'features_json', v_existing.features_json,
      'stripe_price_id', v_existing.stripe_price_id,
      'apple_sku', v_existing.apple_sku,
      'google_sku', v_existing.google_sku,
      'is_control', v_existing.is_control,
      'web_price_cents', v_existing.web_price_cents,
      'ios_price_cents', v_existing.ios_price_cents,
      'android_price_cents', v_existing.android_price_cents,
      'assigned', false
    );
  END IF;

  -- Weighted random assignment
  SELECT SUM(weight) INTO v_total_weight
  FROM public.paywall_variants WHERE experiment_id = v_experiment.id;

  v_rand := random() * v_total_weight;

  FOR v_variant IN
    SELECT * FROM public.paywall_variants
    WHERE experiment_id = v_experiment.id ORDER BY variant_key
  LOOP
    v_cumulative := v_cumulative + v_variant.weight;
    IF v_rand <= v_cumulative THEN
      -- Attempt insert
      INSERT INTO public.experiment_assignments (
        user_id, experiment_id, variant_id, variant, platform
      ) VALUES (
        p_user_id, v_experiment.id, v_variant.id, v_variant.variant_key, p_platform
      )
      ON CONFLICT (experiment_id, user_id) DO NOTHING;

      -- FIX 4: Always re-read actual stored assignment (race-safe)
      SELECT ea.*, pv.variant_key, pv.price_cents, pv.currency,
             pv.layout, pv.trigger_context, pv.urgency_type,
             pv.headline, pv.subheadline, pv.cta_text,
             pv.features_json, pv.stripe_price_id,
             pv.apple_sku, pv.google_sku, pv.is_control,
             pv.web_price_cents, pv.ios_price_cents, pv.android_price_cents
      INTO v_actual_assignment
      FROM public.experiment_assignments ea
      JOIN public.paywall_variants pv ON pv.id = ea.variant_id
      WHERE ea.user_id = p_user_id AND ea.experiment_id = v_experiment.id;

      RETURN jsonb_build_object(
        'variant_key', v_actual_assignment.variant_key,
        'price_cents', v_actual_assignment.price_cents,
        'currency', v_actual_assignment.currency,
        'layout', v_actual_assignment.layout,
        'trigger_context', v_actual_assignment.trigger_context,
        'urgency_type', v_actual_assignment.urgency_type,
        'headline', v_actual_assignment.headline,
        'subheadline', v_actual_assignment.subheadline,
        'cta_text', v_actual_assignment.cta_text,
        'features_json', v_actual_assignment.features_json,
        'stripe_price_id', v_actual_assignment.stripe_price_id,
        'apple_sku', v_actual_assignment.apple_sku,
        'google_sku', v_actual_assignment.google_sku,
        'is_control', v_actual_assignment.is_control,
        'web_price_cents', v_actual_assignment.web_price_cents,
        'ios_price_cents', v_actual_assignment.ios_price_cents,
        'android_price_cents', v_actual_assignment.android_price_cents,
        'assigned', true
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('error', 'no_variant_assigned');
END;
$$;

REVOKE ALL ON FUNCTION public.assign_paywall_variant(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_paywall_variant(uuid, text, text) TO service_role;
