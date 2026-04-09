
-- ════════════════════════════════════════════════════
-- Partner-System: Affiliate + Agency
-- ════════════════════════════════════════════════════

-- 1. partner_accounts
CREATE TABLE public.partner_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  partner_type text NOT NULL CHECK (partner_type IN ('affiliate','agency')),
  company_name text,
  contact_name text,
  email text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('active','inactive','blocked','pending')),
  referral_code text UNIQUE NOT NULL,
  payout_method text CHECK (payout_method IN ('bank_transfer','paypal','stripe_manual')),
  payout_details_json jsonb DEFAULT '{}'::jsonb,
  tax_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partner_accounts_user_id ON public.partner_accounts(user_id);
CREATE INDEX idx_partner_accounts_referral_code ON public.partner_accounts(referral_code);
CREATE INDEX idx_partner_accounts_status ON public.partner_accounts(status);

ALTER TABLE public.partner_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can view own account"
  ON public.partner_accounts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Partners can update own account"
  ON public.partner_accounts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. partner_tracking_links
CREATE TABLE public.partner_tracking_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partner_accounts(id) ON DELETE CASCADE,
  slug text UNIQUE NOT NULL,
  target_path text NOT NULL DEFAULT '/',
  campaign_name text,
  channel text,
  content_key text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partner_tracking_links_partner ON public.partner_tracking_links(partner_id);
CREATE INDEX idx_partner_tracking_links_slug ON public.partner_tracking_links(slug);

ALTER TABLE public.partner_tracking_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can view own links"
  ON public.partner_tracking_links FOR SELECT
  TO authenticated
  USING (partner_id IN (SELECT id FROM public.partner_accounts WHERE user_id = auth.uid()));

CREATE POLICY "Partners can insert own links"
  ON public.partner_tracking_links FOR INSERT
  TO authenticated
  WITH CHECK (partner_id IN (SELECT id FROM public.partner_accounts WHERE user_id = auth.uid()));

CREATE POLICY "Partners can update own links"
  ON public.partner_tracking_links FOR UPDATE
  TO authenticated
  USING (partner_id IN (SELECT id FROM public.partner_accounts WHERE user_id = auth.uid()));

-- 3. partner_click_events
CREATE TABLE public.partner_click_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partner_accounts(id) ON DELETE CASCADE,
  tracking_link_id uuid REFERENCES public.partner_tracking_links(id) ON DELETE SET NULL,
  ref_code text,
  landing_path text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  session_id text,
  visitor_id text,
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partner_clicks_partner ON public.partner_click_events(partner_id);
CREATE INDEX idx_partner_clicks_created ON public.partner_click_events(created_at DESC);

ALTER TABLE public.partner_click_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can view own clicks"
  ON public.partner_click_events FOR SELECT
  TO authenticated
  USING (partner_id IN (SELECT id FROM public.partner_accounts WHERE user_id = auth.uid()));

-- Service role inserts via edge function (no anon insert)

-- 4. partner_attributions
CREATE TABLE public.partner_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partner_accounts(id) ON DELETE CASCADE,
  user_id uuid,
  org_id uuid,
  attribution_type text NOT NULL CHECK (attribution_type IN ('b2c','b2b')),
  first_touch_at timestamptz NOT NULL DEFAULT now(),
  last_touch_at timestamptz NOT NULL DEFAULT now(),
  source_tracking_link_id uuid REFERENCES public.partner_tracking_links(id) ON DELETE SET NULL,
  source_campaign text,
  attribution_status text NOT NULL DEFAULT 'active' CHECK (attribution_status IN ('active','expired','consumed','replaced')),
  metadata_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partner_attr_partner ON public.partner_attributions(partner_id);
CREATE INDEX idx_partner_attr_user ON public.partner_attributions(user_id);
CREATE INDEX idx_partner_attr_status ON public.partner_attributions(attribution_status);

ALTER TABLE public.partner_attributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can view own attributions"
  ON public.partner_attributions FOR SELECT
  TO authenticated
  USING (partner_id IN (SELECT id FROM public.partner_accounts WHERE user_id = auth.uid()));

-- 5. partner_commission_rules
CREATE TABLE public.partner_commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_type text NOT NULL CHECK (partner_type IN ('affiliate','agency')),
  product_id uuid,
  organization_only boolean NOT NULL DEFAULT false,
  commission_mode text NOT NULL CHECK (commission_mode IN ('percentage','fixed','revenue_share')),
  commission_rate numeric NOT NULL DEFAULT 0,
  fixed_amount_eur numeric DEFAULT 0,
  cookie_days integer NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partner_comm_rules_type ON public.partner_commission_rules(partner_type, status);

ALTER TABLE public.partner_commission_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read active rules"
  ON public.partner_commission_rules FOR SELECT
  TO authenticated
  USING (status = 'active');

-- 6. partner_commissions
CREATE TABLE public.partner_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partner_accounts(id) ON DELETE CASCADE,
  attribution_id uuid REFERENCES public.partner_attributions(id) ON DELETE SET NULL,
  product_id uuid,
  order_ref text,
  buyer_user_id uuid,
  org_id uuid,
  gross_amount_eur numeric NOT NULL DEFAULT 0,
  net_amount_eur numeric NOT NULL DEFAULT 0,
  commission_mode text,
  commission_rate numeric,
  commission_amount_eur numeric NOT NULL DEFAULT 0,
  commission_status text NOT NULL DEFAULT 'pending' CHECK (commission_status IN ('pending','approved','rejected','paid','cancelled')),
  commission_reason text,
  approved_at timestamptz,
  paid_at timestamptz,
  metadata_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partner_comm_partner ON public.partner_commissions(partner_id);
CREATE INDEX idx_partner_comm_status ON public.partner_commissions(commission_status);
CREATE UNIQUE INDEX idx_partner_comm_order_ref ON public.partner_commissions(order_ref) WHERE order_ref IS NOT NULL;

ALTER TABLE public.partner_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can view own commissions"
  ON public.partner_commissions FOR SELECT
  TO authenticated
  USING (partner_id IN (SELECT id FROM public.partner_accounts WHERE user_id = auth.uid()));

-- 7. partner_payout_requests
CREATE TABLE public.partner_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partner_accounts(id) ON DELETE CASCADE,
  requested_amount_eur numeric NOT NULL,
  approved_amount_eur numeric,
  payout_status text NOT NULL DEFAULT 'requested' CHECK (payout_status IN ('requested','approved','paid','rejected')),
  payout_reference text,
  notes text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partner_payouts_partner ON public.partner_payout_requests(partner_id);
CREATE INDEX idx_partner_payouts_status ON public.partner_payout_requests(payout_status);

ALTER TABLE public.partner_payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can view own payouts"
  ON public.partner_payout_requests FOR SELECT
  TO authenticated
  USING (partner_id IN (SELECT id FROM public.partner_accounts WHERE user_id = auth.uid()));

CREATE POLICY "Partners can request payouts"
  ON public.partner_payout_requests FOR INSERT
  TO authenticated
  WITH CHECK (partner_id IN (SELECT id FROM public.partner_accounts WHERE user_id = auth.uid()));

-- 8. partner_assets
CREATE TABLE public.partner_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type text NOT NULL CHECK (asset_type IN ('banner','landingpage_copy','email_copy','ad_copy','video_script','social_post','pdf','link_bundle')),
  title text NOT NULL,
  description text,
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('affiliate','agency','all')),
  file_url text,
  content_json jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.partner_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can view active assets"
  ON public.partner_assets FOR SELECT
  TO authenticated
  USING (is_active = true);

-- 9. partner_leads
CREATE TABLE public.partner_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partner_accounts(id) ON DELETE CASCADE,
  lead_type text NOT NULL CHECK (lead_type IN ('b2c','b2b')),
  lead_status text NOT NULL DEFAULT 'new' CHECK (lead_status IN ('new','qualified','converted','lost')),
  org_name text,
  contact_name text,
  contact_email text,
  source text,
  metadata_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partner_leads_partner ON public.partner_leads(partner_id);

ALTER TABLE public.partner_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can view own leads"
  ON public.partner_leads FOR SELECT
  TO authenticated
  USING (partner_id IN (SELECT id FROM public.partner_accounts WHERE user_id = auth.uid()));

CREATE POLICY "Partners can insert own leads"
  ON public.partner_leads FOR INSERT
  TO authenticated
  WITH CHECK (partner_id IN (SELECT id FROM public.partner_accounts WHERE user_id = auth.uid()));

-- 10. partner_audit_events
CREATE TABLE public.partner_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES public.partner_accounts(id) ON DELETE SET NULL,
  actor_user_id uuid,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partner_audit_partner ON public.partner_audit_events(partner_id);
CREATE INDEX idx_partner_audit_created ON public.partner_audit_events(created_at DESC);

ALTER TABLE public.partner_audit_events ENABLE ROW LEVEL SECURITY;

-- No public read — only via admin edge functions

-- 11. Add referred_by_partner_id to organizations
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS referred_by_partner_id uuid REFERENCES public.partner_accounts(id) ON DELETE SET NULL;

-- 12. Updated_at triggers
CREATE OR REPLACE FUNCTION public.partner_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_partner_accounts_updated BEFORE UPDATE ON public.partner_accounts FOR EACH ROW EXECUTE FUNCTION public.partner_updated_at();
CREATE TRIGGER trg_partner_tracking_links_updated BEFORE UPDATE ON public.partner_tracking_links FOR EACH ROW EXECUTE FUNCTION public.partner_updated_at();
CREATE TRIGGER trg_partner_attributions_updated BEFORE UPDATE ON public.partner_attributions FOR EACH ROW EXECUTE FUNCTION public.partner_updated_at();
CREATE TRIGGER trg_partner_commission_rules_updated BEFORE UPDATE ON public.partner_commission_rules FOR EACH ROW EXECUTE FUNCTION public.partner_updated_at();
CREATE TRIGGER trg_partner_commissions_updated BEFORE UPDATE ON public.partner_commissions FOR EACH ROW EXECUTE FUNCTION public.partner_updated_at();
CREATE TRIGGER trg_partner_payout_requests_updated BEFORE UPDATE ON public.partner_payout_requests FOR EACH ROW EXECUTE FUNCTION public.partner_updated_at();
CREATE TRIGGER trg_partner_assets_updated BEFORE UPDATE ON public.partner_assets FOR EACH ROW EXECUTE FUNCTION public.partner_updated_at();
CREATE TRIGGER trg_partner_leads_updated BEFORE UPDATE ON public.partner_leads FOR EACH ROW EXECUTE FUNCTION public.partner_updated_at();

-- 13. Seed default commission rules
INSERT INTO public.partner_commission_rules (partner_type, commission_mode, commission_rate, cookie_days, priority, status) VALUES
  ('affiliate', 'percentage', 25, 30, 100, 'active'),
  ('agency', 'percentage', 35, 60, 100, 'active'),
  ('agency', 'revenue_share', 10, 60, 200, 'active');

-- 14. RPC: calculate_partner_commission (idempotent)
CREATE OR REPLACE FUNCTION public.calculate_partner_commission(
  p_partner_id uuid,
  p_attribution_id uuid,
  p_product_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT 0,
  p_order_ref text DEFAULT NULL,
  p_buyer_user_id uuid DEFAULT NULL,
  p_org_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_type text;
  v_rule record;
  v_commission_amount numeric;
  v_commission_id uuid;
  v_existing_id uuid;
BEGIN
  -- Idempotency: check if commission already exists for this order
  IF p_order_ref IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM partner_commissions WHERE order_ref = p_order_ref LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  -- Get partner type
  SELECT partner_type INTO v_partner_type FROM partner_accounts WHERE id = p_partner_id AND status = 'active';
  IF v_partner_type IS NULL THEN
    RAISE EXCEPTION 'Partner not found or inactive';
  END IF;

  -- Find best matching rule (lowest priority number = highest precedence)
  SELECT * INTO v_rule
  FROM partner_commission_rules
  WHERE partner_type = v_partner_type
    AND status = 'active'
    AND (product_id IS NULL OR product_id = p_product_id)
    AND (NOT organization_only OR p_org_id IS NOT NULL)
  ORDER BY
    CASE WHEN product_id IS NOT NULL THEN 0 ELSE 1 END,
    priority ASC
  LIMIT 1;

  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'No matching commission rule found';
  END IF;

  -- Calculate commission
  CASE v_rule.commission_mode
    WHEN 'percentage' THEN
      v_commission_amount := ROUND(p_amount * v_rule.commission_rate / 100, 2);
    WHEN 'fixed' THEN
      v_commission_amount := v_rule.fixed_amount_eur;
    WHEN 'revenue_share' THEN
      v_commission_amount := ROUND(p_amount * v_rule.commission_rate / 100, 2);
    ELSE
      RAISE EXCEPTION 'Unknown commission mode: %', v_rule.commission_mode;
  END CASE;

  -- Insert commission
  INSERT INTO partner_commissions (
    partner_id, attribution_id, product_id, order_ref, buyer_user_id, org_id,
    gross_amount_eur, net_amount_eur, commission_mode, commission_rate,
    commission_amount_eur, commission_status
  ) VALUES (
    p_partner_id, p_attribution_id, p_product_id, p_order_ref, p_buyer_user_id, p_org_id,
    p_amount, p_amount, v_rule.commission_mode, v_rule.commission_rate,
    v_commission_amount, 'pending'
  )
  RETURNING id INTO v_commission_id;

  -- Audit log
  INSERT INTO partner_audit_events (partner_id, actor_user_id, event_type, entity_type, entity_id, metadata_json)
  VALUES (p_partner_id, p_buyer_user_id, 'commission_created', 'partner_commissions', v_commission_id,
    jsonb_build_object('amount', v_commission_amount, 'mode', v_rule.commission_mode, 'rate', v_rule.commission_rate, 'order_ref', p_order_ref));

  -- Consume attribution
  IF p_attribution_id IS NOT NULL THEN
    UPDATE partner_attributions SET attribution_status = 'consumed', updated_at = now()
    WHERE id = p_attribution_id AND attribution_status = 'active';
  END IF;

  RETURN v_commission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_partner_commission FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_partner_commission TO service_role;

-- 15. RPC: get_partner_dashboard_summary
CREATE OR REPLACE FUNCTION public.get_partner_dashboard_summary(p_partner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_user_id uuid;
BEGIN
  -- Verify caller is the partner
  SELECT user_id INTO v_user_id FROM partner_accounts WHERE id = p_partner_id;
  IF v_user_id IS NULL OR v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'total_clicks', (SELECT COUNT(*) FROM partner_click_events WHERE partner_id = p_partner_id),
    'clicks_30d', (SELECT COUNT(*) FROM partner_click_events WHERE partner_id = p_partner_id AND created_at > now() - interval '30 days'),
    'total_leads', (SELECT COUNT(*) FROM partner_leads WHERE partner_id = p_partner_id),
    'active_attributions', (SELECT COUNT(*) FROM partner_attributions WHERE partner_id = p_partner_id AND attribution_status = 'active'),
    'total_commissions_eur', COALESCE((SELECT SUM(commission_amount_eur) FROM partner_commissions WHERE partner_id = p_partner_id AND commission_status != 'cancelled'), 0),
    'pending_commissions_eur', COALESCE((SELECT SUM(commission_amount_eur) FROM partner_commissions WHERE partner_id = p_partner_id AND commission_status = 'pending'), 0),
    'approved_commissions_eur', COALESCE((SELECT SUM(commission_amount_eur) FROM partner_commissions WHERE partner_id = p_partner_id AND commission_status = 'approved'), 0),
    'paid_commissions_eur', COALESCE((SELECT SUM(commission_amount_eur) FROM partner_commissions WHERE partner_id = p_partner_id AND commission_status = 'paid'), 0),
    'pending_payouts_eur', COALESCE((SELECT SUM(requested_amount_eur) FROM partner_payout_requests WHERE partner_id = p_partner_id AND payout_status = 'requested'), 0),
    'total_conversions', (SELECT COUNT(*) FROM partner_commissions WHERE partner_id = p_partner_id)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_dashboard_summary FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_dashboard_summary TO authenticated;
