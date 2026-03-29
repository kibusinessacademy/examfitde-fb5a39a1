
-- ══════════════════════════════════════════════════════════════
-- Pricing Plans + Sales Leads + B2B Dashboard RPCs
-- ══════════════════════════════════════════════════════════════

-- 1. pricing_plans table
CREATE TABLE IF NOT EXISTS public.pricing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  audience_type text NOT NULL CHECK (audience_type IN ('b2c', 'b2b')),
  plan_key text NOT NULL UNIQUE,
  title text NOT NULL,
  subtitle text,
  description text,
  seat_count integer,
  price_cents integer,
  currency text NOT NULL DEFAULT 'EUR',
  duration_days integer NOT NULL DEFAULT 365,
  checkout_mode text NOT NULL CHECK (checkout_mode IN ('self_service', 'sales')),
  stripe_price_id text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_featured boolean NOT NULL DEFAULT false,
  features_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_plans_product ON public.pricing_plans(product_id);
CREATE INDEX IF NOT EXISTS idx_pricing_plans_audience ON public.pricing_plans(audience_type);
CREATE INDEX IF NOT EXISTS idx_pricing_plans_active ON public.pricing_plans(is_active);

CREATE OR REPLACE TRIGGER trg_pricing_plans_updated_at
  BEFORE UPDATE ON public.pricing_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.pricing_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on pricing_plans"
  ON public.pricing_plans FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read active pricing_plans"
  ON public.pricing_plans FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "Anon read active pricing_plans"
  ON public.pricing_plans FOR SELECT TO anon USING (is_active = true);

-- 2. sales_leads table
CREATE TABLE IF NOT EXISTS public.sales_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  org_name text,
  contact_name text,
  contact_email text,
  requested_product_id uuid REFERENCES public.products(id),
  requested_plan_key text,
  requested_seat_count integer,
  message text,
  source text NOT NULL DEFAULT 'pricing_page',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','closed_won','closed_lost')),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_sales_leads_updated_at
  BEFORE UPDATE ON public.sales_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.sales_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on sales_leads"
  ON public.sales_leads FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Auth users can insert own sales_leads"
  ON public.sales_leads FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 3. RPC: resolve_pricing_plans
CREATE OR REPLACE FUNCTION public.resolve_pricing_plans(
  p_product_id uuid,
  p_audience_type text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, plan_key text, title text, subtitle text, description text,
  audience_type text, seat_count integer, price_cents integer, currency text,
  duration_days integer, checkout_mode text, stripe_price_id text,
  sort_order integer, is_featured boolean, features_json jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT pp.id, pp.plan_key, pp.title, pp.subtitle, pp.description,
    pp.audience_type, pp.seat_count, pp.price_cents, pp.currency,
    pp.duration_days, pp.checkout_mode, pp.stripe_price_id,
    pp.sort_order, pp.is_featured, pp.features_json
  FROM public.pricing_plans pp
  WHERE pp.product_id = p_product_id AND pp.is_active = true
    AND (p_audience_type IS NULL OR pp.audience_type = p_audience_type)
  ORDER BY pp.sort_order ASC;
$$;
REVOKE ALL ON FUNCTION public.resolve_pricing_plans FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_pricing_plans TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_pricing_plans TO anon;

-- 4. RPC: create_sales_lead
CREATE OR REPLACE FUNCTION public.create_sales_lead(
  p_user_id uuid, p_org_name text DEFAULT NULL, p_contact_name text DEFAULT NULL,
  p_contact_email text DEFAULT NULL, p_product_id uuid DEFAULT NULL,
  p_plan_key text DEFAULT NULL, p_seat_count integer DEFAULT NULL,
  p_message text DEFAULT NULL, p_source text DEFAULT 'pricing_page'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.sales_leads (user_id, org_name, contact_name, contact_email,
    requested_product_id, requested_plan_key, requested_seat_count, message, source)
  VALUES (p_user_id, p_org_name, p_contact_name, p_contact_email,
    p_product_id, p_plan_key, p_seat_count, p_message, p_source)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_sales_lead FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sales_lead TO authenticated;

-- 5. Org Dashboard RPCs

CREATE OR REPLACE FUNCTION public.get_org_dashboard_overview(p_org_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result json;
BEGIN
  SELECT json_build_object(
    'org_id', p_org_id,
    'total_active_licenses', (SELECT count(*) FROM public.org_licenses WHERE org_id = p_org_id AND status = 'active'),
    'total_seats', (SELECT coalesce(sum(seat_count), 0) FROM public.org_licenses WHERE org_id = p_org_id AND status = 'active'),
    'used_seats', (SELECT coalesce(sum(seats_used), 0) FROM public.org_licenses WHERE org_id = p_org_id AND status = 'active'),
    'available_seats', (SELECT coalesce(sum(seat_count - seats_used), 0) FROM public.org_licenses WHERE org_id = p_org_id AND status = 'active'),
    'active_learners', (SELECT count(DISTINCT ols.user_id) FROM public.org_license_seats ols
      JOIN public.org_licenses ol ON ol.id = ols.license_id
      WHERE ol.org_id = p_org_id AND ol.status = 'active' AND ols.released_at IS NULL)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_org_dashboard_overview FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_dashboard_overview TO authenticated;

CREATE OR REPLACE FUNCTION public.get_org_license_list(p_org_id uuid)
RETURNS TABLE (
  license_id uuid, product_id uuid, product_title text,
  seats_total integer, seats_used integer, seats_available integer,
  valid_from timestamptz, valid_until timestamptz, status text, source_ref text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ol.id, ol.product_id, p.title,
    ol.seat_count, ol.seats_used, (ol.seat_count - ol.seats_used),
    ol.starts_at, ol.ends_at, ol.status, ol.contract_ref
  FROM public.org_licenses ol LEFT JOIN public.products p ON p.id = ol.product_id
  WHERE ol.org_id = p_org_id
  ORDER BY ol.status = 'active' DESC, ol.starts_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_org_license_list FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_license_list TO authenticated;

CREATE OR REPLACE FUNCTION public.get_org_seat_members(p_org_id uuid)
RETURNS TABLE (
  seat_id uuid, license_id uuid, user_id uuid, product_id uuid, product_title text,
  claimed_at timestamptz, released_at timestamptz, seat_status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ols.id, ols.license_id, ols.user_id, ol.product_id, p.title,
    ols.claimed_at::timestamptz, ols.released_at::timestamptz,
    CASE WHEN ols.released_at IS NOT NULL THEN 'revoked' ELSE 'active' END
  FROM public.org_license_seats ols
  JOIN public.org_licenses ol ON ol.id = ols.license_id
  LEFT JOIN public.products p ON p.id = ol.product_id
  WHERE ol.org_id = p_org_id
  ORDER BY ols.released_at IS NULL DESC, ols.claimed_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_org_seat_members FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_seat_members TO authenticated;

-- assign_org_seat
CREATE OR REPLACE FUNCTION public.assign_org_seat(p_license_id uuid, p_user_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_license public.org_licenses%ROWTYPE;
  v_existing_id uuid;
BEGIN
  SELECT * INTO v_license FROM public.org_licenses WHERE id = p_license_id FOR UPDATE;
  IF v_license IS NULL THEN RETURN json_build_object('success', false, 'message', 'License not found'); END IF;
  IF v_license.status <> 'active' THEN RETURN json_build_object('success', false, 'message', 'License is not active'); END IF;
  IF v_license.ends_at IS NOT NULL AND v_license.ends_at < now() THEN RETURN json_build_object('success', false, 'message', 'License expired'); END IF;
  IF v_license.seats_used >= v_license.seat_count THEN RETURN json_build_object('success', false, 'message', 'All seats occupied'); END IF;

  SELECT id INTO v_existing_id FROM public.org_license_seats WHERE license_id = p_license_id AND user_id = p_user_id AND released_at IS NULL;
  IF v_existing_id IS NOT NULL THEN RETURN json_build_object('success', false, 'message', 'User already has seat'); END IF;

  INSERT INTO public.org_license_seats (license_id, user_id, claimed_at) VALUES (p_license_id, p_user_id, now());
  UPDATE public.org_licenses SET seats_used = seats_used + 1 WHERE id = p_license_id;

  RETURN json_build_object('success', true, 'message', 'Seat assigned',
    'seats_used', v_license.seats_used + 1, 'seats_available', v_license.seat_count - v_license.seats_used - 1);
END;
$$;
REVOKE ALL ON FUNCTION public.assign_org_seat FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_org_seat TO authenticated;

-- revoke_org_seat
CREATE OR REPLACE FUNCTION public.revoke_org_seat(p_license_id uuid, p_user_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seat_id uuid; v_license public.org_licenses%ROWTYPE;
BEGIN
  SELECT * INTO v_license FROM public.org_licenses WHERE id = p_license_id FOR UPDATE;
  IF v_license IS NULL THEN RETURN json_build_object('success', false, 'message', 'License not found'); END IF;

  SELECT id INTO v_seat_id FROM public.org_license_seats WHERE license_id = p_license_id AND user_id = p_user_id AND released_at IS NULL;
  IF v_seat_id IS NULL THEN RETURN json_build_object('success', false, 'message', 'No active seat'); END IF;

  UPDATE public.org_license_seats SET released_at = now() WHERE id = v_seat_id;
  UPDATE public.org_licenses SET seats_used = GREATEST(seats_used - 1, 0) WHERE id = p_license_id;

  RETURN json_build_object('success', true, 'message', 'Seat revoked',
    'seats_used', GREATEST(v_license.seats_used - 1, 0),
    'seats_available', v_license.seat_count - GREATEST(v_license.seats_used - 1, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_org_seat FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_org_seat TO authenticated;
