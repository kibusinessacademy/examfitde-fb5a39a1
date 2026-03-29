
-- ═══════════════════════════════════════════════════════════════
-- Mobile Store Integration Foundation (Apple IAP + Google Play)
-- Uses mobile_store_* prefix to distinguish from legacy Stripe store tables
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Tables ──────────────────────────────────────────────────

CREATE TABLE public.mobile_store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  store text NOT NULL,
  store_sku text NOT NULL,
  store_product_type text NOT NULL,
  pricing_tier_ref text,
  regional_config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store, store_sku),
  CONSTRAINT mobile_store_products_store_check CHECK (store IN ('apple','google')),
  CONSTRAINT mobile_store_products_type_check CHECK (store_product_type IN ('non_consumable','subscription','bundle'))
);

CREATE TABLE public.mobile_store_purchase_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store text NOT NULL,
  external_transaction_id text NOT NULL,
  external_original_transaction_id text,
  store_sku text NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  learner_identity_id uuid REFERENCES public.learner_identities(id),
  app_account_token text,
  raw_payload_json jsonb NOT NULL,
  verification_status text NOT NULL DEFAULT 'pending',
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store, external_transaction_id),
  CONSTRAINT mobile_store_purchase_events_store_check CHECK (store IN ('apple','google')),
  CONSTRAINT mobile_store_purchase_events_status_check CHECK (verification_status IN ('pending','verified','rejected','error'))
);

CREATE TABLE public.mobile_store_receipt_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_event_id uuid NOT NULL REFERENCES public.mobile_store_purchase_events(id) ON DELETE CASCADE,
  entitlement_id uuid REFERENCES public.entitlements(id),
  verification_provider text,
  verified_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  CONSTRAINT mobile_store_receipt_links_status_check CHECK (status IN ('active','revoked','refunded','expired'))
);

CREATE TABLE public.mobile_store_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store text NOT NULL,
  event_type text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_store_sync_log_store_check CHECK (store IN ('apple','google'))
);

-- ── 2. Indexes ─────────────────────────────────────────────────

CREATE INDEX idx_mobile_store_products_product ON public.mobile_store_products(product_id);
CREATE INDEX idx_mobile_store_products_store_sku ON public.mobile_store_products(store, store_sku);
CREATE INDEX idx_mobile_store_purchase_events_store_tx ON public.mobile_store_purchase_events(store, external_transaction_id);
CREATE INDEX idx_mobile_store_purchase_events_user ON public.mobile_store_purchase_events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_mobile_store_purchase_events_learner ON public.mobile_store_purchase_events(learner_identity_id) WHERE learner_identity_id IS NOT NULL;
CREATE INDEX idx_mobile_store_purchase_events_status ON public.mobile_store_purchase_events(verification_status);
CREATE INDEX idx_mobile_store_receipt_links_event ON public.mobile_store_receipt_links(purchase_event_id);
CREATE INDEX idx_mobile_store_receipt_links_entitlement ON public.mobile_store_receipt_links(entitlement_id) WHERE entitlement_id IS NOT NULL;

-- ── 3. RLS ─────────────────────────────────────────────────────

ALTER TABLE public.mobile_store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_store_purchase_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_store_receipt_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_store_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full" ON public.mobile_store_products FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "auth_read_active" ON public.mobile_store_products FOR SELECT TO authenticated USING (is_active = true);

CREATE POLICY "service_role_full" ON public.mobile_store_purchase_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "user_read_own" ON public.mobile_store_purchase_events FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "service_role_full" ON public.mobile_store_receipt_links FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full" ON public.mobile_store_sync_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 4. updated_at Triggers ─────────────────────────────────────

CREATE TRIGGER trg_mobile_store_products_updated_at
  BEFORE UPDATE ON public.mobile_store_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5. RPCs ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_mobile_store_product(
  p_store text,
  p_store_sku text
)
RETURNS TABLE (
  store_product_id uuid,
  product_id uuid,
  store_product_type text,
  is_active boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT sp.id, sp.product_id, sp.store_product_type, sp.is_active
  FROM public.mobile_store_products sp
  WHERE sp.store = p_store AND sp.store_sku = p_store_sku
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_mobile_store_product(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_mobile_store_product(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_mobile_learner_identity(
  p_user_id uuid,
  p_app_account_token text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.learner_identities
  WHERE user_id = p_user_id AND identity_type IN ('mobile_only','native')
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    IF p_app_account_token IS NOT NULL THEN
      UPDATE public.learner_identities
      SET metadata_json = jsonb_set(COALESCE(metadata_json,'{}'::jsonb), '{app_account_token}', to_jsonb(p_app_account_token)),
          updated_at = now()
      WHERE id = v_id;
    END IF;
    RETURN v_id;
  END IF;

  SELECT id INTO v_id FROM public.learner_identities WHERE user_id = p_user_id LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.learner_identities (identity_type, user_id, metadata_json)
  VALUES ('mobile_only', p_user_id,
    CASE WHEN p_app_account_token IS NOT NULL
      THEN jsonb_build_object('app_account_token', p_app_account_token)
      ELSE '{}'::jsonb END)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_mobile_learner_identity(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_mobile_learner_identity(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_mobile_store_entitlement(
  p_store text,
  p_purchase_event_id uuid,
  p_product_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_learner_identity_id uuid DEFAULT NULL,
  p_source_ref text DEFAULT NULL,
  p_is_subscription boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_entitlement_id uuid;
  v_source_type text;
  v_existing uuid;
  v_curriculum_id uuid;
BEGIN
  v_source_type := CASE WHEN p_store = 'apple' THEN 'apple_iap' ELSE 'google_play' END;

  SELECT rl.entitlement_id INTO v_existing
  FROM public.mobile_store_receipt_links rl
  WHERE rl.purchase_event_id = p_purchase_event_id AND rl.status = 'active'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT p.curriculum_id INTO v_curriculum_id FROM public.products p WHERE p.id = p_product_id;

  INSERT INTO public.entitlements (
    user_id, curriculum_id, product_id, learner_identity_id,
    source_type, source_ref, valid_from, valid_until, source, metadata_json
  ) VALUES (
    COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(v_curriculum_id, '00000000-0000-0000-0000-000000000000'::uuid),
    p_product_id, p_learner_identity_id, v_source_type,
    COALESCE(p_source_ref, p_purchase_event_id::text),
    now(),
    CASE WHEN p_is_subscription THEN now() + interval '30 days' ELSE '2099-12-31'::timestamptz END,
    p_store,
    jsonb_build_object('purchase_event_id', p_purchase_event_id)
  ) RETURNING id INTO v_entitlement_id;

  INSERT INTO public.mobile_store_receipt_links (purchase_event_id, entitlement_id, verification_provider, verified_at, status)
  VALUES (p_purchase_event_id, v_entitlement_id, p_store, now(), 'active');

  RETURN v_entitlement_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_mobile_store_entitlement(text, uuid, uuid, uuid, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_mobile_store_entitlement(text, uuid, uuid, uuid, uuid, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_mobile_store_entitlement(
  p_purchase_event_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count int := 0;
BEGIN
  UPDATE public.mobile_store_receipt_links SET status = 'revoked'
  WHERE purchase_event_id = p_purchase_event_id AND status = 'active';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.entitlements e
  SET valid_until = now(),
      metadata_json = e.metadata_json || jsonb_build_object('revoke_reason', p_reason, 'revoked_at', now()::text)
  WHERE e.id IN (
    SELECT rl.entitlement_id FROM public.mobile_store_receipt_links rl
    WHERE rl.purchase_event_id = p_purchase_event_id AND rl.entitlement_id IS NOT NULL
  );

  RETURN v_count > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_mobile_store_entitlement(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_mobile_store_entitlement(uuid, text) TO service_role;

-- ── 6. Audit View ──────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_mobile_store_purchase_audit AS
SELECT
  spe.id AS purchase_event_id, spe.store, spe.store_sku,
  spe.external_transaction_id, spe.verification_status,
  spe.user_id, spe.created_at AS purchase_created_at,
  srl.id AS receipt_link_id, srl.entitlement_id,
  srl.status AS receipt_link_status,
  e.valid_until, e.source_type
FROM public.mobile_store_purchase_events spe
LEFT JOIN public.mobile_store_receipt_links srl ON srl.purchase_event_id = spe.id
LEFT JOIN public.entitlements e ON e.id = srl.entitlement_id
ORDER BY spe.created_at DESC;

REVOKE SELECT ON public.v_mobile_store_purchase_audit FROM anon, authenticated;

-- ── 7. Job type registration ───────────────────────────────────

INSERT INTO public.ops_job_type_registry (job_type, description, pool)
VALUES ('reconcile_store_purchases', 'Reconcile pending/error mobile store purchase events', 'ops')
ON CONFLICT (job_type) DO NOTHING;
