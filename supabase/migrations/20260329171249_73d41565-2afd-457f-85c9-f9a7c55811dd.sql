
-- ═══════════════════════════════════════════════════════════════
-- Mobile Store P0 Hardening: Subscription Lifecycle, Identity Linking,
-- Enhanced Verification States, Audit Views
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Extend verification_status to support full lifecycle ────
ALTER TABLE public.mobile_store_purchase_events
  DROP CONSTRAINT mobile_store_purchase_events_status_check;

ALTER TABLE public.mobile_store_purchase_events
  ADD CONSTRAINT mobile_store_purchase_events_status_check
  CHECK (verification_status IN (
    'pending',
    'provider_verified',
    'verified',
    'rejected',
    'error',
    'refunded',
    'expired'
  ));

-- ── 2. Add subscription lifecycle columns to purchase events ───
ALTER TABLE public.mobile_store_purchase_events
  ADD COLUMN IF NOT EXISTS environment text DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS bundle_id text,
  ADD COLUMN IF NOT EXISTS is_subscription boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscription_group_id text,
  ADD COLUMN IF NOT EXISTS subscription_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS auto_renew_status boolean,
  ADD COLUMN IF NOT EXISTS revocation_reason text,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_verification_json jsonb;

-- ── 3. Add identity linking policy columns ─────────────────────
-- purchase_context: tracks whether purchase was made pre-login or post-login
ALTER TABLE public.mobile_store_purchase_events
  ADD COLUMN IF NOT EXISTS purchase_context text NOT NULL DEFAULT 'authenticated'
    CONSTRAINT mobile_store_purchase_context_check
    CHECK (purchase_context IN ('authenticated','anonymous','restore','transfer'));

-- link_status: tracks whether anonymous purchase was later linked to a user
ALTER TABLE public.mobile_store_purchase_events
  ADD COLUMN IF NOT EXISTS link_status text NOT NULL DEFAULT 'linked'
    CONSTRAINT mobile_store_link_status_check
    CHECK (link_status IN ('linked','unlinked','pending_link','conflict'));

ALTER TABLE public.mobile_store_purchase_events
  ADD COLUMN IF NOT EXISTS linked_at timestamptz;

-- ── 4. Add receipt link lifecycle columns ──────────────────────
ALTER TABLE public.mobile_store_receipt_links
  ADD COLUMN IF NOT EXISTS subscription_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_renewal_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoke_reason text,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- ── 5. New indexes for lifecycle queries ───────────────────────
CREATE INDEX IF NOT EXISTS idx_mobile_store_pe_subscription
  ON public.mobile_store_purchase_events(is_subscription)
  WHERE is_subscription = true;

CREATE INDEX IF NOT EXISTS idx_mobile_store_pe_environment
  ON public.mobile_store_purchase_events(environment);

CREATE INDEX IF NOT EXISTS idx_mobile_store_pe_link_status
  ON public.mobile_store_purchase_events(link_status)
  WHERE link_status != 'linked';

CREATE INDEX IF NOT EXISTS idx_mobile_store_pe_original_tx
  ON public.mobile_store_purchase_events(external_original_transaction_id)
  WHERE external_original_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mobile_store_rl_sub_end
  ON public.mobile_store_receipt_links(subscription_period_end)
  WHERE subscription_period_end IS NOT NULL;

-- ── 6. Enhanced create_mobile_store_entitlement with subscription lifecycle ──

CREATE OR REPLACE FUNCTION public.create_mobile_store_entitlement(
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_entitlement_id uuid;
  v_source_type text;
  v_existing uuid;
  v_curriculum_id uuid;
  v_valid_until timestamptz;
BEGIN
  v_source_type := CASE WHEN p_store = 'apple' THEN 'apple_iap' ELSE 'google_play' END;

  -- Idempotency: check existing active receipt link for this purchase
  SELECT rl.entitlement_id INTO v_existing
  FROM public.mobile_store_receipt_links rl
  WHERE rl.purchase_event_id = p_purchase_event_id AND rl.status = 'active'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- If subscription with new period, update the entitlement
    IF p_is_subscription AND p_subscription_period_end IS NOT NULL THEN
      UPDATE public.entitlements
      SET valid_until = p_subscription_period_end,
          metadata_json = metadata_json || jsonb_build_object(
            'last_renewal_at', now()::text,
            'subscription_period_end', p_subscription_period_end::text
          )
      WHERE id = v_existing AND valid_until < p_subscription_period_end;

      UPDATE public.mobile_store_receipt_links
      SET subscription_period_end = p_subscription_period_end,
          renewal_count = renewal_count + 1,
          last_renewal_at = now()
      WHERE purchase_event_id = p_purchase_event_id AND status = 'active';
    END IF;
    RETURN v_existing;
  END IF;

  SELECT p.curriculum_id INTO v_curriculum_id FROM public.products p WHERE p.id = p_product_id;

  -- Determine valid_until based on product type
  IF p_is_subscription THEN
    v_valid_until := COALESCE(p_subscription_period_end, now() + interval '30 days');
  ELSE
    v_valid_until := '2099-12-31'::timestamptz;
  END IF;

  INSERT INTO public.entitlements (
    user_id, curriculum_id, product_id, learner_identity_id,
    source_type, source_ref, valid_from, valid_until, source, metadata_json
  ) VALUES (
    COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(v_curriculum_id, '00000000-0000-0000-0000-000000000000'::uuid),
    p_product_id, p_learner_identity_id, v_source_type,
    COALESCE(p_source_ref, p_purchase_event_id::text),
    COALESCE(p_subscription_period_start, now()),
    v_valid_until,
    p_store,
    jsonb_build_object(
      'purchase_event_id', p_purchase_event_id,
      'is_subscription', p_is_subscription,
      'subscription_period_start', COALESCE(p_subscription_period_start, now())::text,
      'subscription_period_end', v_valid_until::text
    )
  ) RETURNING id INTO v_entitlement_id;

  INSERT INTO public.mobile_store_receipt_links (
    purchase_event_id, entitlement_id, verification_provider, verified_at, status,
    subscription_period_start, subscription_period_end
  ) VALUES (
    p_purchase_event_id, v_entitlement_id, p_store, now(), 'active',
    p_subscription_period_start, p_subscription_period_end
  );

  RETURN v_entitlement_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_mobile_store_entitlement(text, uuid, uuid, uuid, uuid, text, boolean, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_mobile_store_entitlement(text, uuid, uuid, uuid, uuid, text, boolean, timestamptz, timestamptz) TO service_role;

-- ── 7. Link anonymous purchase to user ─────────────────────────

CREATE OR REPLACE FUNCTION public.link_mobile_store_purchase_to_user(
  p_purchase_event_id uuid,
  p_user_id uuid,
  p_app_account_token text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_event record;
  v_learner_identity_id uuid;
BEGIN
  SELECT * INTO v_event FROM public.mobile_store_purchase_events
  WHERE id = p_purchase_event_id AND link_status IN ('unlinked', 'pending_link')
  FOR UPDATE;

  IF v_event IS NULL THEN RETURN false; END IF;

  -- Ensure learner identity
  SELECT public.ensure_mobile_learner_identity(p_user_id, p_app_account_token)
  INTO v_learner_identity_id;

  -- Update purchase event
  UPDATE public.mobile_store_purchase_events
  SET user_id = p_user_id,
      learner_identity_id = v_learner_identity_id,
      link_status = 'linked',
      linked_at = now(),
      purchase_context = CASE WHEN purchase_context = 'anonymous' THEN 'anonymous' ELSE purchase_context END
  WHERE id = p_purchase_event_id;

  -- Update associated entitlements
  UPDATE public.entitlements
  SET user_id = p_user_id,
      learner_identity_id = v_learner_identity_id
  WHERE id IN (
    SELECT rl.entitlement_id FROM public.mobile_store_receipt_links rl
    WHERE rl.purchase_event_id = p_purchase_event_id AND rl.entitlement_id IS NOT NULL
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.link_mobile_store_purchase_to_user(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_mobile_store_purchase_to_user(uuid, uuid, text) TO service_role;

-- ── 8. Expire subscription entitlements ────────────────────────

CREATE OR REPLACE FUNCTION public.expire_mobile_store_subscriptions()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  -- Mark receipt links as expired where subscription period has passed
  UPDATE public.mobile_store_receipt_links rl
  SET status = 'expired',
      revoke_reason = 'subscription_expired'
  WHERE rl.subscription_period_end IS NOT NULL
    AND rl.subscription_period_end < now()
    AND rl.status = 'active';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Also expire the associated entitlements
  UPDATE public.entitlements e
  SET valid_until = now(),
      metadata_json = e.metadata_json || jsonb_build_object('expired_by', 'subscription_lifecycle', 'expired_at', now()::text)
  WHERE e.valid_until < now()
    AND e.source_type IN ('apple_iap', 'google_play')
    AND e.valid_until > '2000-01-01'::timestamptz;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_mobile_store_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_mobile_store_subscriptions() TO service_role;

-- ── 9. Enhanced audit view with orphan detection ───────────────

DROP VIEW IF EXISTS public.v_mobile_store_purchase_audit;

CREATE OR REPLACE VIEW public.v_mobile_store_purchase_audit AS
SELECT
  spe.id AS purchase_event_id,
  spe.store,
  spe.store_sku,
  spe.external_transaction_id,
  spe.external_original_transaction_id,
  spe.verification_status,
  spe.environment,
  spe.is_subscription,
  spe.subscription_period_start,
  spe.subscription_period_end,
  spe.auto_renew_status,
  spe.purchase_context,
  spe.link_status,
  spe.user_id,
  spe.created_at AS purchase_created_at,
  spe.processed_at,
  srl.id AS receipt_link_id,
  srl.entitlement_id,
  srl.status AS receipt_link_status,
  srl.renewal_count,
  srl.last_renewal_at,
  srl.revoke_reason,
  e.valid_from,
  e.valid_until,
  e.source_type,
  -- Anomaly markers
  CASE WHEN spe.verification_status = 'verified' AND srl.id IS NULL THEN true ELSE false END AS verified_without_receipt_link,
  CASE WHEN spe.verification_status = 'verified' AND srl.entitlement_id IS NULL THEN true ELSE false END AS verified_without_entitlement,
  CASE WHEN srl.status = 'active' AND e.valid_until < now() THEN true ELSE false END AS active_but_expired,
  CASE WHEN spe.verification_status = 'refunded' AND srl.status = 'active' THEN true ELSE false END AS refunded_but_active,
  CASE WHEN spe.link_status = 'unlinked' THEN true ELSE false END AS unlinked_purchase
FROM public.mobile_store_purchase_events spe
LEFT JOIN public.mobile_store_receipt_links srl ON srl.purchase_event_id = spe.id
LEFT JOIN public.entitlements e ON e.id = srl.entitlement_id
ORDER BY spe.created_at DESC;

REVOKE SELECT ON public.v_mobile_store_purchase_audit FROM anon, authenticated;

-- ── 10. Register expire job type ───────────────────────────────

INSERT INTO public.ops_job_type_registry (job_type, description, pool)
VALUES ('expire_store_subscriptions', 'Expire mobile store subscription entitlements past their period end', 'ops')
ON CONFLICT (job_type) DO NOTHING;
