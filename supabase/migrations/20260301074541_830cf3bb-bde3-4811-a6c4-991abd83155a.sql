
-- BerufsKI Commerce v6: Coupons, Affiliates, Email Outbox, Download Tokens

-- 1) Extend berufski_produkte with publish + commerce fields
ALTER TABLE public.berufski_produkte
  ADD COLUMN IF NOT EXISTS published_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS stripe_product_id text NULL,
  ADD COLUMN IF NOT EXISTS amount_cents int NULL;

-- 2) Extend berufski_purchases with guest checkout + download gate fields
ALTER TABLE public.berufski_purchases
  ADD COLUMN IF NOT EXISTS user_email text NULL,
  ADD COLUMN IF NOT EXISTS download_token text NULL,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS coupon_code text NULL,
  ADD COLUMN IF NOT EXISTS affiliate_code text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_berufski_purchases_download_token
  ON public.berufski_purchases(download_token) WHERE download_token IS NOT NULL;

-- 3) BerufsKI Coupons
CREATE TABLE IF NOT EXISTS public.berufski_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  type text NOT NULL CHECK (type IN ('percent','fixed')),
  value numeric NOT NULL,
  max_redemptions int NULL,
  redeemed_count int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  stripe_coupon_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.berufski_coupons ENABLE ROW LEVEL SECURITY;

-- 4) Coupon Redemptions
CREATE TABLE IF NOT EXISTS public.berufski_coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_code text NOT NULL,
  purchase_id uuid NOT NULL REFERENCES public.berufski_purchases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.berufski_coupon_redemptions ENABLE ROW LEVEL SECURITY;

-- 5) BerufsKI Affiliates (separate from examfit affiliates)
CREATE TABLE IF NOT EXISTS public.berufski_affiliates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  payout_percent numeric NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.berufski_affiliates ENABLE ROW LEVEL SECURITY;

-- 6) Affiliate Clicks
CREATE TABLE IF NOT EXISTS public.berufski_affiliate_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_code text NOT NULL,
  landing_path text NOT NULL,
  referrer text NULL,
  user_agent text NULL,
  ip_hash text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.berufski_affiliate_clicks ENABLE ROW LEVEL SECURITY;

-- 7) Email Outbox (Resend)
CREATE TABLE IF NOT EXISTS public.berufski_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  error text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL
);

ALTER TABLE public.berufski_email_outbox ENABLE ROW LEVEL SECURITY;

-- 8) Lock down all new tables (service_role only for MVP)
DO $$ BEGIN
  REVOKE ALL ON TABLE public.berufski_coupons FROM anon, authenticated;
  REVOKE ALL ON TABLE public.berufski_coupon_redemptions FROM anon, authenticated;
  REVOKE ALL ON TABLE public.berufski_affiliates FROM anon, authenticated;
  REVOKE ALL ON TABLE public.berufski_affiliate_clicks FROM anon, authenticated;
  REVOKE ALL ON TABLE public.berufski_email_outbox FROM anon, authenticated;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 9) RPC: increment coupon redeemed count
CREATE OR REPLACE FUNCTION public.berufski_increment_coupon_redeemed(p_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.berufski_coupons
  SET redeemed_count = redeemed_count + 1
  WHERE code = p_code;
END;
$$;

REVOKE ALL ON FUNCTION public.berufski_increment_coupon_redeemed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.berufski_increment_coupon_redeemed(text) TO service_role;

-- 10) Seed defaults
INSERT INTO public.berufski_coupons (code, type, value, max_redemptions, active)
VALUES ('START10', 'percent', 10, 500, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.berufski_affiliates (code, name, payout_percent, status)
VALUES ('EXAMFIT', 'ExamFit Cross-Sell', 30, 'active')
ON CONFLICT (code) DO NOTHING;
