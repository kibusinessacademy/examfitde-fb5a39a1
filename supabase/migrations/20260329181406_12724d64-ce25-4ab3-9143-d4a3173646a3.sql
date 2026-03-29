
-- Store P0 Final Security Pass

-- 1. Harden verification_status
ALTER TABLE public.mobile_store_purchase_events
  DROP CONSTRAINT IF EXISTS mobile_store_purchase_events_verification_status_check;

ALTER TABLE public.mobile_store_purchase_events
  ADD CONSTRAINT mobile_store_purchase_events_verification_status_check
  CHECK (verification_status IN ('pending','structurally_valid','provider_verified','verified','rejected','refunded','expired','error'));

-- 2. Drop both old overloads
DROP FUNCTION IF EXISTS public.create_mobile_store_entitlement(text, uuid, uuid, uuid, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.create_mobile_store_entitlement(text, uuid, uuid, uuid, uuid, text, boolean, timestamptz, timestamptz);

-- 3. Recreate with security gate
CREATE FUNCTION public.create_mobile_store_entitlement(
  p_store text,
  p_purchase_event_id uuid,
  p_product_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_learner_identity_id uuid DEFAULT NULL,
  p_source_ref text DEFAULT NULL,
  p_is_subscription boolean DEFAULT false,
  p_subscription_period_start timestamptz DEFAULT NULL,
  p_subscription_period_end timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entitlement_id uuid;
  v_source_type text;
  v_existing_link_id uuid;
  v_existing_entitlement_id uuid;
  v_event_status text;
BEGIN
  SELECT verification_status INTO v_event_status
  FROM mobile_store_purchase_events WHERE id = p_purchase_event_id;

  IF v_event_status IS NULL THEN
    RAISE EXCEPTION 'Purchase event % not found', p_purchase_event_id;
  END IF;

  IF v_event_status NOT IN ('provider_verified', 'verified') THEN
    RAISE EXCEPTION 'Cannot create entitlement: event % status is %, need provider_verified or verified',
      p_purchase_event_id, v_event_status;
  END IF;

  v_source_type := CASE WHEN p_store = 'apple' THEN 'apple_iap' ELSE 'google_play' END;

  SELECT rl.id, rl.entitlement_id INTO v_existing_link_id, v_existing_entitlement_id
  FROM mobile_store_receipt_links rl
  WHERE rl.purchase_event_id = p_purchase_event_id AND rl.status = 'active' LIMIT 1;

  IF v_existing_entitlement_id IS NOT NULL AND p_is_subscription AND p_subscription_period_end IS NOT NULL THEN
    UPDATE entitlements SET valid_until = p_subscription_period_end
    WHERE id = v_existing_entitlement_id AND (valid_until IS NULL OR valid_until < p_subscription_period_end);

    UPDATE mobile_store_receipt_links
    SET subscription_period_start = COALESCE(p_subscription_period_start, subscription_period_start),
        subscription_period_end = p_subscription_period_end,
        renewal_count = renewal_count + 1, last_renewal_at = now()
    WHERE id = v_existing_link_id;
    RETURN v_existing_entitlement_id;
  END IF;

  IF v_existing_entitlement_id IS NOT NULL THEN RETURN v_existing_entitlement_id; END IF;

  INSERT INTO entitlements (user_id, learner_identity_id, product_id, source_type, source_ref, valid_from, valid_until)
  VALUES (p_user_id, p_learner_identity_id, p_product_id, v_source_type, p_source_ref, now(),
    CASE WHEN p_is_subscription THEN p_subscription_period_end ELSE NULL END)
  RETURNING id INTO v_entitlement_id;

  INSERT INTO mobile_store_receipt_links (purchase_event_id, entitlement_id, verification_provider, verified_at, status, subscription_period_start, subscription_period_end)
  VALUES (p_purchase_event_id, v_entitlement_id, p_store, now(), 'active', p_subscription_period_start, p_subscription_period_end);

  RETURN v_entitlement_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_mobile_store_entitlement FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_mobile_store_entitlement TO service_role;
GRANT EXECUTE ON FUNCTION public.create_mobile_store_entitlement TO authenticated;

-- 4. Updated audit view
DROP VIEW IF EXISTS public.v_mobile_store_purchase_audit;
CREATE VIEW public.v_mobile_store_purchase_audit AS
SELECT
  pe.id AS purchase_event_id, pe.store, pe.store_sku, pe.external_transaction_id,
  pe.verification_status, pe.purchase_context, pe.link_status,
  pe.is_subscription, pe.subscription_period_start, pe.subscription_period_end,
  pe.environment, pe.bundle_id, pe.created_at AS purchased_at, pe.processed_at,
  rl.id AS receipt_link_id, rl.entitlement_id, rl.status AS receipt_link_status,
  rl.renewal_count, rl.last_renewal_at,
  e.valid_from AS entitlement_valid_from, e.valid_until AS entitlement_valid_until,
  CASE WHEN pe.verification_status = 'provider_verified' AND rl.id IS NULL THEN true ELSE false END AS verified_without_receipt_link,
  CASE WHEN pe.verification_status = 'provider_verified' AND rl.entitlement_id IS NULL THEN true ELSE false END AS verified_without_entitlement,
  CASE WHEN e.valid_until IS NOT NULL AND e.valid_until < now() THEN true ELSE false END AS active_but_expired,
  CASE WHEN pe.verification_status = 'refunded' AND e.id IS NOT NULL THEN true ELSE false END AS refunded_but_active,
  CASE WHEN pe.link_status = 'unlinked' THEN true ELSE false END AS unlinked_purchase,
  CASE WHEN pe.verification_status = 'structurally_valid' THEN true ELSE false END AS awaiting_provider_verification
FROM mobile_store_purchase_events pe
LEFT JOIN mobile_store_receipt_links rl ON rl.purchase_event_id = pe.id
LEFT JOIN entitlements e ON e.id = rl.entitlement_id;

REVOKE SELECT ON public.v_mobile_store_purchase_audit FROM anon, authenticated;
GRANT SELECT ON public.v_mobile_store_purchase_audit TO service_role;
