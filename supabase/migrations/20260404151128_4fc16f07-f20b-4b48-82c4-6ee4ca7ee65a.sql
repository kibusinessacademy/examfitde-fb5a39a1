
-- =============================================
-- product_prices: Pricing SSOT für Checkout
-- =============================================
CREATE TABLE IF NOT EXISTS public.product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'EUR',
  amount_cents int NOT NULL,
  billing_type text NOT NULL DEFAULT 'one_time' CHECK (billing_type IN ('one_time')),
  access_months int NOT NULL DEFAULT 12,
  compare_at_cents int,
  active boolean NOT NULL DEFAULT true,
  stripe_price_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_prices_product ON public.product_prices(product_id);
CREATE INDEX idx_product_prices_active ON public.product_prices(product_id, active) WHERE active = true;

ALTER TABLE public.product_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active prices"
  ON public.product_prices FOR SELECT
  USING (active = true);

CREATE POLICY "Service role can manage prices"
  ON public.product_prices FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================
-- tracking_events: Conversion-Funnel-Events
-- =============================================
CREATE TABLE IF NOT EXISTS public.tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  session_id text,
  event_name text NOT NULL,
  product_slug text,
  landing_type text,
  page_path text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tracking_events_name ON public.tracking_events(event_name);
CREATE INDEX idx_tracking_events_product ON public.tracking_events(product_slug);
CREATE INDEX idx_tracking_events_created ON public.tracking_events(created_at);
CREATE INDEX idx_tracking_events_user ON public.tracking_events(user_id);

ALTER TABLE public.tracking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert tracking events"
  ON public.tracking_events FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anon users can insert tracking events"
  ON public.tracking_events FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Service role can read all tracking events"
  ON public.tracking_events FOR SELECT
  TO service_role
  USING (true);

-- =============================================
-- RLS for existing orders table (if missing)
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'Users can view own orders'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can view own orders" ON public.orders FOR SELECT TO authenticated USING (buyer_user_id = auth.uid())';
  END IF;
END $$;

-- =============================================
-- RLS for existing entitlements table (if missing)  
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entitlements' AND policyname = 'Users can view own entitlements'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can view own entitlements" ON public.entitlements FOR SELECT TO authenticated USING (user_id = auth.uid())';
  END IF;
END $$;

-- =============================================
-- updated_at trigger for product_prices
-- =============================================
CREATE OR REPLACE FUNCTION public.update_product_prices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_product_prices_updated_at
  BEFORE UPDATE ON public.product_prices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_product_prices_updated_at();
