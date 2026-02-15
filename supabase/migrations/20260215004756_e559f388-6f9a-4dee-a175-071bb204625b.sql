
-- ==========================================
-- STORE-READY ARCHITEKTUR: SKU Mapping, Receipt Validation, Content Packages
-- ==========================================

-- 1) Platform SKU Mapping: Verbindet store_products mit Apple/Google SKUs
CREATE TABLE public.platform_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.store_products(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  sku TEXT NOT NULL,                      -- z.B. 'com.examfit.bundle.12m'
  store_product_id TEXT,                  -- Apple Product ID / Google Product ID
  price_tier TEXT,                        -- z.B. 'tier_39' (Apple) oder Preisangabe
  is_consumable BOOLEAN DEFAULT false,    -- Non-consumable (Standard für Lizenzen)
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(platform, sku)
);

ALTER TABLE public.platform_skus ENABLE ROW LEVEL SECURITY;

-- Public read für App-Client (braucht SKU-Liste)
CREATE POLICY "Anyone can read active SKUs"
  ON public.platform_skus FOR SELECT
  USING (is_active = true);

-- Admin-only write
CREATE POLICY "Admins can manage SKUs"
  ON public.platform_skus FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) Receipt Validations: Audit-Log für Store-Käufe
CREATE TABLE public.store_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  sku TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  original_transaction_id TEXT,           -- für Renewal-Tracking
  receipt_data TEXT,                       -- verschlüsselter/gehashter Receipt
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'valid', 'invalid', 'fraud', 'refunded')),
  validation_response JSONB,
  product_id UUID REFERENCES public.store_products(id),
  curriculum_id UUID,
  entitlement_id UUID REFERENCES public.entitlements(id),
  purchased_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  environment TEXT DEFAULT 'production'    -- 'sandbox' / 'production'
    CHECK (environment IN ('sandbox', 'production')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(platform, transaction_id)
);

ALTER TABLE public.store_receipts ENABLE ROW LEVEL SECURITY;

-- User sieht nur eigene Receipts
CREATE POLICY "Users can view own receipts"
  ON public.store_receipts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service-Role schreibt (Edge Functions)
CREATE POLICY "Service can manage receipts"
  ON public.store_receipts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3) Content Packages: Offline-Lernpakete (ZIP-Bundles)
CREATE TABLE public.content_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id UUID NOT NULL,
  course_id UUID,
  version INTEGER NOT NULL DEFAULT 1,
  format TEXT NOT NULL DEFAULT 'zip'
    CHECK (format IN ('zip', 'delta')),
  manifest JSONB NOT NULL DEFAULT '{}',   -- { assets: [], checksums: {}, size_bytes: ... }
  checksum_sha256 TEXT,
  size_bytes BIGINT,
  storage_path TEXT,                       -- Pfad im Storage-Bucket
  signature TEXT,                          -- Ed25519 / JWT Signatur
  is_current BOOLEAN DEFAULT true,
  build_status TEXT DEFAULT 'pending'
    CHECK (build_status IN ('pending', 'building', 'ready', 'failed', 'deprecated')),
  built_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(curriculum_id, version)
);

ALTER TABLE public.content_packages ENABLE ROW LEVEL SECURITY;

-- Nur User mit Entitlement dürfen Pakete sehen (Manifest/Metadaten)
CREATE POLICY "Entitled users can view content packages"
  ON public.content_packages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.entitlements e
      WHERE e.user_id = auth.uid()
        AND e.curriculum_id = content_packages.curriculum_id
        AND e.valid_until > now()
    )
  );

-- Admin + Service schreibt
CREATE POLICY "Admins can manage content packages"
  ON public.content_packages FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4) Store-Kauf-Entitlement Bridge: Erweitert entitlements um Store-Quelle
ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web'
    CHECK (source IN ('web', 'ios', 'android', 'promo', 'enterprise')),
  ADD COLUMN IF NOT EXISTS store_receipt_id UUID REFERENCES public.store_receipts(id),
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN DEFAULT false;

-- 5) Feature Flags für regionale Store-Policies
CREATE TABLE public.store_policy_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key TEXT NOT NULL UNIQUE,          -- z.B. 'ios_external_purchase_link_eu'
  platform TEXT CHECK (platform IN ('ios', 'android', 'all')),
  regions TEXT[] DEFAULT '{}',            -- z.B. {'DE', 'AT', 'EU'}
  is_enabled BOOLEAN DEFAULT false,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.store_policy_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read store policy flags"
  ON public.store_policy_flags FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage store policy flags"
  ON public.store_policy_flags FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 6) Helper: Entitlement aus Store-Kauf erstellen
CREATE OR REPLACE FUNCTION public.create_store_entitlement(
  p_user_id UUID,
  p_product_id UUID,
  p_curriculum_id UUID,
  p_platform TEXT,
  p_receipt_id UUID,
  p_expires_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product store_products%ROWTYPE;
  v_entitlement_id UUID;
BEGIN
  SELECT * INTO v_product FROM store_products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found: %', p_product_id;
  END IF;

  INSERT INTO entitlements (
    user_id, curriculum_id, source, store_receipt_id,
    has_learning_course, has_exam_trainer, has_ai_tutor, has_oral_trainer,
    valid_from, valid_until
  ) VALUES (
    p_user_id, p_curriculum_id, p_platform, p_receipt_id,
    v_product.includes_learning_course,
    v_product.includes_exam_trainer,
    v_product.includes_ai_tutor,
    v_product.includes_oral_trainer,
    now(),
    p_expires_at
  )
  RETURNING id INTO v_entitlement_id;

  RETURN v_entitlement_id;
END;
$$;
