
-- ══════════════════════════════════════════════════════════════
-- Dual-Engine Foundation DELTA
-- Adds: org_memberships, paywall_experiments, paywall_variants
-- Extends: organizations (slug, contact fields), org_licenses (seats_used)
-- RPCs: check_org_license_access, assign_paywall_variant, record_experiment_conversion
-- ══════════════════════════════════════════════════════════════

-- ── Extend organizations with missing fields ─────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- ── Extend org_licenses with seats_used ──────────────────────
ALTER TABLE public.org_licenses
  ADD COLUMN IF NOT EXISTS seats_used integer NOT NULL DEFAULT 0;

-- ── B2B: Org Memberships ─────────────────────────────────────
CREATE TABLE public.org_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'learner'
    CHECK (role IN ('owner', 'admin', 'manager', 'learner')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'invited', 'suspended', 'removed')),
  invited_by uuid,
  invited_at timestamptz,
  joined_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

CREATE INDEX idx_org_memberships_user ON public.org_memberships(user_id);
CREATE INDEX idx_org_memberships_org ON public.org_memberships(org_id);

ALTER TABLE public.org_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_org_memberships" ON public.org_memberships
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "users_read_own_memberships" ON public.org_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "org_admins_manage_memberships" ON public.org_memberships
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_memberships om2
      WHERE om2.org_id = org_memberships.org_id
        AND om2.user_id = auth.uid()
        AND om2.role IN ('owner', 'admin')
        AND om2.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.org_memberships om2
      WHERE om2.org_id = org_memberships.org_id
        AND om2.user_id = auth.uid()
        AND om2.role IN ('owner', 'admin')
        AND om2.status = 'active'
    )
  );

-- ── B2C: Paywall Experiments ─────────────────────────────────
CREATE TABLE public.paywall_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  traffic_pct integer NOT NULL DEFAULT 100 CHECK (traffic_pct BETWEEN 0 AND 100),
  target_product_id uuid REFERENCES public.products(id),
  start_at timestamptz,
  end_at timestamptz,
  winning_variant_id uuid,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.paywall_experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_paywall_experiments" ON public.paywall_experiments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_active_experiments" ON public.paywall_experiments
  FOR SELECT TO authenticated
  USING (status = 'active');

-- ── B2C: Paywall Variants ────────────────────────────────────
CREATE TABLE public.paywall_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.paywall_experiments(id) ON DELETE CASCADE,
  variant_key text NOT NULL,
  weight integer NOT NULL DEFAULT 50 CHECK (weight BETWEEN 0 AND 100),
  price_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  layout text NOT NULL DEFAULT 'standard'
    CHECK (layout IN ('minimal', 'standard', 'value_heavy', 'urgency', 'social_proof')),
  trigger_context text NOT NULL DEFAULT 'direct'
    CHECK (trigger_context IN ('direct', 'after_quiz', 'after_fail', 'after_simulation', 'after_readiness_check', 'time_based')),
  urgency_type text DEFAULT 'none'
    CHECK (urgency_type IN ('none', 'countdown', 'limited_seats', 'price_increase')),
  headline text,
  subheadline text,
  cta_text text DEFAULT 'Jetzt starten',
  features_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  stripe_price_id text,
  apple_sku text,
  google_sku text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_control boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(experiment_id, variant_key)
);

CREATE INDEX idx_paywall_variants_experiment ON public.paywall_variants(experiment_id);

ALTER TABLE public.paywall_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_paywall_variants" ON public.paywall_variants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_variants" ON public.paywall_variants
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.paywall_experiments pe
      WHERE pe.id = paywall_variants.experiment_id AND pe.status = 'active'
    )
  );

-- ── Extend experiment_assignments ────────────────────────────
-- existing: id, experiment_id, user_id, variant, assigned_at
-- add conversion tracking + variant_id FK
ALTER TABLE public.experiment_assignments
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.paywall_variants(id),
  ADD COLUMN IF NOT EXISTS converted_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversion_value_cents integer,
  ADD COLUMN IF NOT EXISTS platform text DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── updated_at triggers ──────────────────────────────────────
CREATE TRIGGER set_updated_at_org_memberships
  BEFORE UPDATE ON public.org_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_paywall_experiments
  BEFORE UPDATE ON public.paywall_experiments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ══════════════════════════════════════════════════════════════
-- RPCs
-- ══════════════════════════════════════════════════════════════

-- ── Org license access check ─────────────────────────────────
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
    FROM public.org_memberships om
    JOIN public.org_licenses ol ON ol.org_id = om.org_id
    WHERE om.user_id = p_user_id
      AND om.status = 'active'
      AND ol.product_id = p_product_id
      AND ol.status = 'active'
      AND (ol.seats_used < ol.seat_count)
      AND (ol.ends_at IS NULL OR ol.ends_at > now())
  );
$$;

REVOKE ALL ON FUNCTION public.check_org_license_access FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_org_license_access TO service_role;
GRANT EXECUTE ON FUNCTION public.check_org_license_access TO authenticated;

-- ── Assign paywall variant ───────────────────────────────────
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
         pv.apple_sku, pv.google_sku, pv.is_control
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
      INSERT INTO public.experiment_assignments (
        user_id, experiment_id, variant_id, variant, platform
      ) VALUES (
        p_user_id, v_experiment.id, v_variant.id, v_variant.variant_key, p_platform
      )
      ON CONFLICT (experiment_id, user_id) DO NOTHING;

      RETURN jsonb_build_object(
        'variant_key', v_variant.variant_key,
        'price_cents', v_variant.price_cents,
        'currency', v_variant.currency,
        'layout', v_variant.layout,
        'trigger_context', v_variant.trigger_context,
        'urgency_type', v_variant.urgency_type,
        'headline', v_variant.headline,
        'subheadline', v_variant.subheadline,
        'cta_text', v_variant.cta_text,
        'features_json', v_variant.features_json,
        'stripe_price_id', v_variant.stripe_price_id,
        'apple_sku', v_variant.apple_sku,
        'google_sku', v_variant.google_sku,
        'is_control', v_variant.is_control,
        'assigned', true
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('error', 'no_variant_assigned');
END;
$$;

REVOKE ALL ON FUNCTION public.assign_paywall_variant FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_paywall_variant TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_paywall_variant TO authenticated;

-- ── Record conversion ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_experiment_conversion(
  p_user_id uuid,
  p_experiment_key text,
  p_value_cents integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.experiment_assignments ea
  SET converted_at = now(), conversion_value_cents = p_value_cents
  FROM public.paywall_experiments pe
  WHERE ea.experiment_id = pe.id
    AND pe.experiment_key = p_experiment_key
    AND ea.user_id = p_user_id
    AND ea.converted_at IS NULL;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.record_experiment_conversion FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_experiment_conversion TO service_role;

-- ── Views ────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_experiment_results AS
SELECT
  pe.experiment_key, pe.name AS experiment_name, pe.status AS experiment_status,
  pv.variant_key, pv.price_cents, pv.layout, pv.is_control,
  COUNT(ea.id) AS assignments,
  COUNT(ea.converted_at) AS conversions,
  CASE WHEN COUNT(ea.id) > 0
    THEN ROUND(COUNT(ea.converted_at)::numeric / COUNT(ea.id) * 100, 2) ELSE 0
  END AS conversion_rate_pct,
  COALESCE(SUM(ea.conversion_value_cents), 0) AS total_revenue_cents
FROM public.paywall_experiments pe
JOIN public.paywall_variants pv ON pv.experiment_id = pe.id
LEFT JOIN public.experiment_assignments ea ON ea.variant_id = pv.id
GROUP BY pe.experiment_key, pe.name, pe.status, pv.variant_key, pv.price_cents, pv.layout, pv.is_control;

REVOKE ALL ON public.v_experiment_results FROM PUBLIC;
GRANT SELECT ON public.v_experiment_results TO service_role;

CREATE OR REPLACE VIEW public.v_org_license_overview AS
SELECT
  o.id AS org_id, o.name AS org_name, o.org_type,
  ol.product_id, ol.seat_count AS seats_total, ol.seats_used,
  ol.seat_count - ol.seats_used AS seats_available,
  ol.starts_at AS valid_from, ol.ends_at AS valid_until,
  ol.status AS license_status,
  (SELECT COUNT(*) FROM public.org_memberships om
   WHERE om.org_id = o.id AND om.status = 'active') AS active_members
FROM public.organizations o
JOIN public.org_licenses ol ON ol.org_id = o.id;

REVOKE ALL ON public.v_org_license_overview FROM PUBLIC;
GRANT SELECT ON public.v_org_license_overview TO service_role;
