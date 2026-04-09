
-- ═══════════════════════════════════════════════════
-- 1. partner_content_jobs table
-- ═══════════════════════════════════════════════════
CREATE TABLE public.partner_content_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partner_accounts(id) ON DELETE CASCADE,
  blueprint_id uuid,
  question_id uuid,
  competency_id uuid,
  content_type text NOT NULL CHECK (content_type IN ('tiktok_video','instagram_reel','ad_copy','email_sequence','landingpage','hook_generator','fehleranalyse_post')),
  platform text NOT NULL CHECK (platform IN ('tiktok','instagram','meta_ads','google_ads','email','landingpage','linkedin','twitter')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generating','completed','failed')),
  hook text,
  output jsonb,
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.partner_content_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners see own content jobs"
  ON public.partner_content_jobs FOR SELECT
  USING (partner_id IN (SELECT id FROM public.partner_accounts WHERE user_id = auth.uid()));

CREATE POLICY "Partners insert own content jobs"
  ON public.partner_content_jobs FOR INSERT
  WITH CHECK (partner_id IN (SELECT id FROM public.partner_accounts WHERE user_id = auth.uid()));

CREATE INDEX idx_partner_content_jobs_partner ON public.partner_content_jobs(partner_id);

-- ═══════════════════════════════════════════════════
-- 2. Click dedup index
-- ═══════════════════════════════════════════════════
CREATE INDEX idx_partner_clicks_dedup
  ON public.partner_click_events(partner_id, visitor_id, created_at DESC)
  WHERE visitor_id IS NOT NULL;

-- ═══════════════════════════════════════════════════
-- 3. resolve_partner_attribution RPC
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.resolve_partner_attribution(
  p_user_id uuid DEFAULT NULL,
  p_org_id uuid DEFAULT NULL,
  p_ref_code text DEFAULT NULL,
  p_tracking_link_id uuid DEFAULT NULL,
  p_session_id text DEFAULT NULL,
  p_visitor_id text DEFAULT NULL,
  p_attribution_type text DEFAULT 'b2c',
  p_event_context text DEFAULT 'checkout'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attribution record;
  v_partner record;
  v_cookie_days int;
  v_result jsonb;
BEGIN
  -- 1. Try existing active attribution for the user
  IF p_user_id IS NOT NULL THEN
    SELECT a.*, pa.partner_type
    INTO v_attribution
    FROM partner_attributions a
    JOIN partner_accounts pa ON pa.id = a.partner_id
    WHERE a.user_id = p_user_id
      AND a.attribution_status = 'active'
    ORDER BY a.last_touch_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  -- 2. Try by org_id
  IF v_attribution IS NULL AND p_org_id IS NOT NULL THEN
    SELECT a.*, pa.partner_type
    INTO v_attribution
    FROM partner_attributions a
    JOIN partner_accounts pa ON pa.id = a.partner_id
    WHERE a.org_id = p_org_id
      AND a.attribution_status = 'active'
    ORDER BY a.last_touch_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  -- 3. Try by ref_code → create new attribution
  IF v_attribution IS NULL AND p_ref_code IS NOT NULL THEN
    SELECT * INTO v_partner
    FROM partner_accounts
    WHERE referral_code = p_ref_code AND status = 'active';

    IF v_partner IS NOT NULL THEN
      INSERT INTO partner_attributions (
        partner_id, user_id, org_id, attribution_type,
        first_touch_at, last_touch_at,
        source_tracking_link_id, source_campaign,
        attribution_status
      ) VALUES (
        v_partner.id, p_user_id, p_org_id, p_attribution_type,
        now(), now(),
        p_tracking_link_id, NULL,
        'active'
      )
      RETURNING * INTO v_attribution;
    END IF;
  END IF;

  -- 4. Try by tracking_link_id → create attribution
  IF v_attribution IS NULL AND p_tracking_link_id IS NOT NULL THEN
    SELECT pa.* INTO v_partner
    FROM partner_tracking_links tl
    JOIN partner_accounts pa ON pa.id = tl.partner_id
    WHERE tl.id = p_tracking_link_id AND tl.is_active = true AND pa.status = 'active';

    IF v_partner IS NOT NULL THEN
      INSERT INTO partner_attributions (
        partner_id, user_id, org_id, attribution_type,
        first_touch_at, last_touch_at,
        source_tracking_link_id, attribution_status
      ) VALUES (
        v_partner.id, p_user_id, p_org_id, p_attribution_type,
        now(), now(),
        p_tracking_link_id, 'active'
      )
      RETURNING * INTO v_attribution;
    END IF;
  END IF;

  IF v_attribution IS NULL THEN
    RETURN NULL;
  END IF;

  -- 5. Check cookie window expiry
  SELECT COALESCE(MAX(cookie_days), 30) INTO v_cookie_days
  FROM partner_commission_rules
  WHERE partner_type = (SELECT partner_type FROM partner_accounts WHERE id = v_attribution.partner_id)
    AND status = 'active';

  IF v_attribution.first_touch_at < now() - (v_cookie_days || ' days')::interval THEN
    UPDATE partner_attributions SET attribution_status = 'expired', updated_at = now()
    WHERE id = v_attribution.id;
    RETURN jsonb_build_object('status', 'expired', 'attribution_id', v_attribution.id);
  END IF;

  RETURN jsonb_build_object(
    'status', 'active',
    'attribution_id', v_attribution.id,
    'partner_id', v_attribution.partner_id,
    'attribution_type', v_attribution.attribution_type,
    'first_touch_at', v_attribution.first_touch_at,
    'cookie_days', v_cookie_days
  );
END;
$$;

-- ═══════════════════════════════════════════════════
-- 4. create_partner_commission RPC (idempotent)
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_partner_commission(
  p_attribution_id uuid,
  p_order_ref text,
  p_gross_amount_eur numeric,
  p_net_amount_eur numeric DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_buyer_user_id uuid DEFAULT NULL,
  p_org_id uuid DEFAULT NULL,
  p_source_type text DEFAULT 'b2c_checkout',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attr record;
  v_rule record;
  v_partner record;
  v_commission_amount numeric;
  v_commission_id uuid;
  v_existing_id uuid;
BEGIN
  -- Validate
  IF p_gross_amount_eur <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid amount');
  END IF;

  -- Get attribution
  SELECT * INTO v_attr FROM partner_attributions WHERE id = p_attribution_id;
  IF v_attr IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Attribution not found');
  END IF;

  IF v_attr.attribution_status != 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Attribution not active: ' || v_attr.attribution_status);
  END IF;

  -- Get partner
  SELECT * INTO v_partner FROM partner_accounts WHERE id = v_attr.partner_id;
  IF v_partner IS NULL OR v_partner.status != 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Partner not active');
  END IF;

  -- Idempotency check: order_ref + partner_id + source_type
  SELECT id INTO v_existing_id
  FROM partner_commissions
  WHERE order_ref = p_order_ref
    AND partner_id = v_attr.partner_id
    AND commission_mode IS NOT NULL;
  
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'commission_id', v_existing_id, 'idempotent', true);
  END IF;

  -- Find best matching rule
  SELECT * INTO v_rule
  FROM partner_commission_rules
  WHERE partner_type = v_partner.partner_type
    AND status = 'active'
    AND (product_id IS NULL OR product_id = p_product_id)
    AND (NOT organization_only OR p_org_id IS NOT NULL)
  ORDER BY
    CASE WHEN product_id IS NOT NULL THEN 0 ELSE 1 END,
    priority ASC
  LIMIT 1;

  IF v_rule IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No matching commission rule');
  END IF;

  -- Calculate commission
  CASE v_rule.commission_mode
    WHEN 'percentage' THEN
      v_commission_amount := ROUND(p_gross_amount_eur * (v_rule.commission_rate / 100.0), 2);
    WHEN 'fixed' THEN
      v_commission_amount := v_rule.fixed_amount_eur;
    WHEN 'revenue_share' THEN
      v_commission_amount := ROUND(COALESCE(p_net_amount_eur, p_gross_amount_eur) * (v_rule.commission_rate / 100.0), 2);
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'Unknown commission mode');
  END CASE;

  IF v_commission_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Calculated commission is zero or negative');
  END IF;

  -- Insert commission
  INSERT INTO partner_commissions (
    partner_id, attribution_id, product_id, order_ref,
    buyer_user_id, org_id, gross_amount_eur, net_amount_eur,
    commission_mode, commission_rate, commission_amount_eur,
    commission_status, commission_reason, metadata_json
  ) VALUES (
    v_attr.partner_id, p_attribution_id, p_product_id, p_order_ref,
    p_buyer_user_id, p_org_id, p_gross_amount_eur, p_net_amount_eur,
    v_rule.commission_mode, v_rule.commission_rate, v_commission_amount,
    'pending', p_source_type, p_metadata
  )
  RETURNING id INTO v_commission_id;

  -- Mark attribution as consumed
  UPDATE partner_attributions
  SET attribution_status = 'consumed', updated_at = now()
  WHERE id = p_attribution_id;

  -- Audit log
  INSERT INTO partner_audit_events (
    partner_id, event_type, entity_type, entity_id, metadata_json
  ) VALUES (
    v_attr.partner_id, 'commission_created', 'partner_commissions', v_commission_id,
    jsonb_build_object(
      'order_ref', p_order_ref,
      'gross', p_gross_amount_eur,
      'commission', v_commission_amount,
      'mode', v_rule.commission_mode,
      'rate', v_rule.commission_rate,
      'source_type', p_source_type
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'commission_id', v_commission_id,
    'commission_amount_eur', v_commission_amount,
    'commission_mode', v_rule.commission_mode,
    'commission_rate', v_rule.commission_rate
  );
END;
$$;

-- ═══════════════════════════════════════════════════
-- 5. create_partner_lead RPC
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_partner_lead(
  p_partner_id uuid,
  p_lead_type text DEFAULT 'b2b',
  p_org_name text DEFAULT NULL,
  p_contact_name text DEFAULT NULL,
  p_contact_email text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_user_id uuid;
BEGIN
  -- Verify caller owns this partner account
  SELECT user_id INTO v_user_id FROM partner_accounts WHERE id = p_partner_id;
  IF v_user_id IS NULL OR v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO partner_leads (
    partner_id, lead_type, lead_status, org_name,
    contact_name, contact_email, source, metadata_json
  ) VALUES (
    p_partner_id, p_lead_type, 'new', p_org_name,
    p_contact_name, p_contact_email, p_source, p_metadata
  )
  RETURNING id INTO v_lead_id;

  INSERT INTO partner_audit_events (
    partner_id, actor_user_id, event_type, entity_type, entity_id,
    metadata_json
  ) VALUES (
    p_partner_id, auth.uid(), 'partner_lead_created', 'partner_leads', v_lead_id,
    jsonb_build_object('org_name', p_org_name, 'lead_type', p_lead_type)
  );

  RETURN jsonb_build_object('ok', true, 'lead_id', v_lead_id);
END;
$$;

-- ═══════════════════════════════════════════════════
-- 6. Unique constraint for idempotent commissions
-- ═══════════════════════════════════════════════════
CREATE UNIQUE INDEX idx_partner_commissions_idempotent
  ON public.partner_commissions(partner_id, order_ref)
  WHERE commission_status != 'cancelled';
