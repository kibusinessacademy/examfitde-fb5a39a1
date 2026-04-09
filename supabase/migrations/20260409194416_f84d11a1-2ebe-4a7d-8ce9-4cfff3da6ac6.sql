
-- ============================================================
-- P0 PARTNER REVENUE ENGINE
-- Attribution + Commission + Payout Hardening
-- ============================================================

-- ── 1. Schema additions ──

-- partner_attributions: lifecycle columns
ALTER TABLE public.partner_attributions
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS replaced_by_id uuid REFERENCES public.partner_attributions(id),
  ADD COLUMN IF NOT EXISTS touch_model text NOT NULL DEFAULT 'last_touch',
  ADD COLUMN IF NOT EXISTS cookie_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS click_event_id uuid REFERENCES public.partner_click_events(id);

-- Index for fast attribution lookups
CREATE INDEX IF NOT EXISTS idx_partner_attributions_user_active
  ON public.partner_attributions (user_id, attribution_status)
  WHERE attribution_status = 'active';

CREATE INDEX IF NOT EXISTS idx_partner_attributions_cookie_expiry
  ON public.partner_attributions (cookie_expires_at)
  WHERE attribution_status = 'active';

-- partner_commissions: idempotency key
ALTER TABLE public.partner_commissions
  ADD COLUMN IF NOT EXISTS source_ref text;

-- Unique constraint to prevent double commissions
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_commissions_source_ref
  ON public.partner_commissions (source_ref)
  WHERE source_ref IS NOT NULL;

-- partner_payout_requests: snapshot
ALTER TABLE public.partner_payout_requests
  ADD COLUMN IF NOT EXISTS commission_snapshot_ids uuid[] DEFAULT '{}';


-- ── 2. fn_resolve_partner_attribution ──
-- Finds the winning attribution for a given user_id or visitor_id
-- Rules:
--   1. Only active, non-expired, non-consumed attributions
--   2. B2B agency attribution wins over B2C affiliate (attribution_type = 'b2b_lead' > 'b2c_referral')
--   3. Last-touch wins within same tier
--   4. Cookie window must be valid

CREATE OR REPLACE FUNCTION public.fn_resolve_partner_attribution(
  _user_id uuid DEFAULT NULL,
  _visitor_id text DEFAULT NULL,
  _org_id uuid DEFAULT NULL,
  _consume boolean DEFAULT false
)
RETURNS TABLE(
  attribution_id uuid,
  partner_id uuid,
  partner_type text,
  attribution_type text,
  source_tracking_link_id uuid,
  source_campaign text,
  commission_rule_id uuid,
  commission_mode text,
  commission_rate numeric,
  fixed_amount_eur numeric,
  cookie_days int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _found_id uuid;
  _found_partner_id uuid;
BEGIN
  -- Find best matching active attribution
  -- Priority: B2B > B2C, then latest last_touch_at
  SELECT a.id, a.partner_id
  INTO _found_id, _found_partner_id
  FROM partner_attributions a
  JOIN partner_accounts pa ON pa.id = a.partner_id AND pa.status = 'active'
  WHERE a.attribution_status = 'active'
    AND (a.cookie_expires_at IS NULL OR a.cookie_expires_at > now())
    AND a.consumed_at IS NULL
    AND a.expired_at IS NULL
    AND (
      (_user_id IS NOT NULL AND a.user_id = _user_id)
      OR (_org_id IS NOT NULL AND a.org_id = _org_id)
    )
  ORDER BY
    -- B2B agency wins over B2C affiliate
    CASE WHEN a.attribution_type = 'b2b_lead' THEN 0 ELSE 1 END,
    -- Latest touch wins
    a.last_touch_at DESC
  LIMIT 1;

  IF _found_id IS NULL THEN
    RETURN;
  END IF;

  -- If consuming, mark as consumed
  IF _consume THEN
    UPDATE partner_attributions
    SET consumed_at = now(),
        attribution_status = 'consumed',
        updated_at = now()
    WHERE id = _found_id;
  END IF;

  -- Return full resolution with matching commission rule
  RETURN QUERY
  SELECT
    a.id AS attribution_id,
    a.partner_id,
    pa.partner_type,
    a.attribution_type,
    a.source_tracking_link_id,
    a.source_campaign,
    cr.id AS commission_rule_id,
    cr.commission_mode,
    cr.commission_rate,
    cr.fixed_amount_eur,
    cr.cookie_days
  FROM partner_attributions a
  JOIN partner_accounts pa ON pa.id = a.partner_id
  LEFT JOIN partner_commission_rules cr
    ON cr.partner_type = pa.partner_type
    AND cr.status = 'active'
    AND (cr.organization_only = false OR a.attribution_type = 'b2b_lead')
  WHERE a.id = _found_id
  ORDER BY cr.priority ASC
  LIMIT 1;
END;
$$;


-- ── 3. fn_create_partner_commission ──
-- Idempotent commission creation
-- source_ref format: "checkout:<stripe_session_id>" or "b2b_conversion:<org_id>"

CREATE OR REPLACE FUNCTION public.fn_create_partner_commission(
  _source_ref text,
  _partner_id uuid,
  _attribution_id uuid DEFAULT NULL,
  _product_id uuid DEFAULT NULL,
  _order_ref text DEFAULT NULL,
  _buyer_user_id uuid DEFAULT NULL,
  _org_id uuid DEFAULT NULL,
  _gross_amount_eur numeric DEFAULT 0,
  _net_amount_eur numeric DEFAULT 0,
  _commission_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing_id uuid;
  _new_id uuid;
  _partner_type text;
  _rule_mode text;
  _rule_rate numeric;
  _rule_fixed numeric;
  _calc_amount numeric;
BEGIN
  -- Idempotency check
  SELECT id INTO _existing_id
  FROM partner_commissions
  WHERE source_ref = _source_ref;

  IF _existing_id IS NOT NULL THEN
    RETURN _existing_id;
  END IF;

  -- Get partner type
  SELECT partner_type INTO _partner_type
  FROM partner_accounts
  WHERE id = _partner_id AND status = 'active';

  IF _partner_type IS NULL THEN
    RAISE EXCEPTION 'Partner not found or inactive: %', _partner_id;
  END IF;

  -- Find matching commission rule
  SELECT commission_mode, commission_rate, fixed_amount_eur
  INTO _rule_mode, _rule_rate, _rule_fixed
  FROM partner_commission_rules
  WHERE partner_type = _partner_type
    AND status = 'active'
    AND (product_id IS NULL OR product_id = _product_id)
    AND (
      (organization_only = false AND _org_id IS NULL)
      OR (organization_only = true AND _org_id IS NOT NULL)
    )
  ORDER BY
    -- Product-specific rules first
    CASE WHEN product_id IS NOT NULL THEN 0 ELSE 1 END,
    priority ASC
  LIMIT 1;

  IF _rule_mode IS NULL THEN
    -- Fallback: no rule found
    _rule_mode := 'percentage';
    _rule_rate := 0;
    _rule_fixed := 0;
  END IF;

  -- Calculate commission
  IF _rule_mode = 'percentage' THEN
    _calc_amount := ROUND(_net_amount_eur * _rule_rate / 100, 2);
  ELSIF _rule_mode = 'fixed' THEN
    _calc_amount := _rule_fixed;
  ELSE
    _calc_amount := ROUND(_net_amount_eur * _rule_rate / 100, 2);
  END IF;

  -- Insert commission
  INSERT INTO partner_commissions (
    partner_id, attribution_id, product_id, order_ref,
    buyer_user_id, org_id, gross_amount_eur, net_amount_eur,
    commission_mode, commission_rate, commission_amount_eur,
    commission_status, commission_reason, source_ref, metadata_json
  ) VALUES (
    _partner_id, _attribution_id, _product_id, _order_ref,
    _buyer_user_id, _org_id, _gross_amount_eur, _net_amount_eur,
    _rule_mode, _rule_rate, _calc_amount,
    'pending', _commission_reason, _source_ref,
    jsonb_build_object('created_via', 'fn_create_partner_commission', 'rule_mode', _rule_mode)
  )
  RETURNING id INTO _new_id;

  -- Consume attribution if provided
  IF _attribution_id IS NOT NULL THEN
    UPDATE partner_attributions
    SET consumed_at = now(),
        attribution_status = 'consumed',
        updated_at = now()
    WHERE id = _attribution_id
      AND consumed_at IS NULL;
  END IF;

  -- Audit event
  INSERT INTO partner_audit_events (partner_id, event_type, entity_type, entity_id, metadata_json)
  VALUES (
    _partner_id, 'commission_created', 'partner_commissions', _new_id,
    jsonb_build_object(
      'source_ref', _source_ref,
      'amount', _calc_amount,
      'mode', _rule_mode,
      'rate', _rule_rate,
      'gross', _gross_amount_eur
    )
  );

  RETURN _new_id;
END;
$$;


-- ── 4. fn_get_partner_available_balance ──
-- Returns approved commission sum minus all non-rejected payout requests

CREATE OR REPLACE FUNCTION public.fn_get_partner_available_balance(_partner_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT SUM(commission_amount_eur)
      FROM partner_commissions
      WHERE partner_id = _partner_id
        AND commission_status = 'approved'
    ), 0
  )
  -
  COALESCE(
    (
      SELECT SUM(COALESCE(approved_amount_eur, requested_amount_eur))
      FROM partner_payout_requests
      WHERE partner_id = _partner_id
        AND payout_status IN ('requested', 'approved', 'paid')
    ), 0
  );
$$;


-- ── 5. fn_request_partner_payout_safe ──
-- Hardened payout request with balance validation

CREATE OR REPLACE FUNCTION public.fn_request_partner_payout_safe(
  _partner_id uuid,
  _requested_amount numeric,
  _min_payout numeric DEFAULT 50
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _available numeric;
  _has_pending boolean;
  _new_id uuid;
  _approved_commission_ids uuid[];
BEGIN
  -- Check for existing pending payout
  SELECT EXISTS(
    SELECT 1 FROM partner_payout_requests
    WHERE partner_id = _partner_id
      AND payout_status = 'requested'
  ) INTO _has_pending;

  IF _has_pending THEN
    RAISE EXCEPTION 'Es gibt bereits eine offene Auszahlungsanfrage.';
  END IF;

  -- Calculate available balance
  _available := fn_get_partner_available_balance(_partner_id);

  IF _available < _min_payout THEN
    RAISE EXCEPTION 'Verfügbarer Betrag (%.2f€) unter Mindestbetrag (%.2f€).', _available, _min_payout;
  END IF;

  IF _requested_amount > _available THEN
    RAISE EXCEPTION 'Angeforderter Betrag (%.2f€) übersteigt verfügbares Guthaben (%.2f€).', _requested_amount, _available;
  END IF;

  -- Snapshot: which approved commissions back this payout
  SELECT ARRAY_AGG(id) INTO _approved_commission_ids
  FROM partner_commissions
  WHERE partner_id = _partner_id
    AND commission_status = 'approved';

  -- Create payout request
  INSERT INTO partner_payout_requests (
    partner_id, requested_amount_eur, payout_status, commission_snapshot_ids
  ) VALUES (
    _partner_id, _requested_amount, 'requested', COALESCE(_approved_commission_ids, '{}')
  )
  RETURNING id INTO _new_id;

  -- Audit
  INSERT INTO partner_audit_events (partner_id, event_type, entity_type, entity_id, metadata_json)
  VALUES (
    _partner_id, 'payout_requested', 'partner_payout_requests', _new_id,
    jsonb_build_object(
      'requested_amount', _requested_amount,
      'available_balance', _available,
      'commission_count', COALESCE(array_length(_approved_commission_ids, 1), 0)
    )
  );

  RETURN _new_id;
END;
$$;


-- ── 6. Expire stale attributions (housekeeping) ──

CREATE OR REPLACE FUNCTION public.fn_expire_stale_attributions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer;
BEGIN
  UPDATE partner_attributions
  SET attribution_status = 'expired',
      expired_at = now(),
      updated_at = now()
  WHERE attribution_status = 'active'
    AND cookie_expires_at IS NOT NULL
    AND cookie_expires_at < now()
    AND consumed_at IS NULL;

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;
