
-- BerufsKI v7: Bundle purchases, corporate checkout, affiliate dashboard support

-- Bundle purchases + download token
CREATE TABLE IF NOT EXISTS public.berufski_bundle_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text NOT NULL,
  bundle_id uuid NOT NULL REFERENCES public.berufski_bundles(id) ON DELETE CASCADE,
  stripe_session_id text UNIQUE NOT NULL,
  stripe_payment_intent_id text NULL,
  amount_paid_cents int NOT NULL,
  currency text NOT NULL DEFAULT 'eur',
  coupon_code text NULL,
  affiliate_code text NULL,
  download_token text UNIQUE NOT NULL,
  token_expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_berufski_bundle_purchases_bundle ON public.berufski_bundle_purchases(bundle_id);
CREATE INDEX IF NOT EXISTS idx_berufski_bundle_purchases_email ON public.berufski_bundle_purchases(user_email);

-- Corporate commerce mapping per plan
CREATE TABLE IF NOT EXISTS public.berufski_corporate_commerce (
  plan text PRIMARY KEY CHECK (plan IN ('team_10','company_100','site')),
  stripe_product_id text NULL,
  stripe_price_id text NULL,
  currency text NOT NULL DEFAULT 'eur',
  amount_cents int NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.berufski_corporate_commerce(plan, amount_cents)
VALUES
  ('team_10', 9900),
  ('company_100', 29900),
  ('site', 79900)
ON CONFLICT (plan) DO NOTHING;

-- Affiliate payouts ledger
CREATE TABLE IF NOT EXISTS public.berufski_affiliate_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_code text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount_cents int NOT NULL,
  currency text NOT NULL DEFAULT 'eur',
  status text NOT NULL DEFAULT 'due' CHECK (status IN ('due','paid')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Affiliate sales view for dashboard
CREATE OR REPLACE VIEW public.berufski_v_affiliate_sales
WITH (security_invoker = on)
AS
SELECT
  a.code AS affiliate_code,
  a.name AS affiliate_name,
  a.payout_percent,
  'eur' AS currency,
  COUNT(DISTINCT p.id) AS product_orders,
  COALESCE(SUM(p.amount_cents), 0)::bigint AS product_revenue_cents,
  COUNT(DISTINCT bp.id) AS bundle_orders,
  COALESCE(SUM(bp.amount_paid_cents), 0)::bigint AS bundle_revenue_cents,
  (COALESCE(SUM(p.amount_cents), 0) + COALESCE(SUM(bp.amount_paid_cents), 0))::bigint AS total_revenue_cents,
  ROUND(((COALESCE(SUM(p.amount_cents), 0) + COALESCE(SUM(bp.amount_paid_cents), 0)) * a.payout_percent / 100.0))::bigint AS est_commission_cents
FROM public.berufski_affiliates a
LEFT JOIN public.berufski_purchases p ON p.affiliate_code = a.code
LEFT JOIN public.berufski_bundle_purchases bp ON bp.affiliate_code = a.code
GROUP BY a.code, a.name, a.payout_percent;

-- RLS: service_role only
ALTER TABLE public.berufski_bundle_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berufski_corporate_commerce ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berufski_affiliate_payouts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  REVOKE ALL ON TABLE public.berufski_bundle_purchases FROM anon, authenticated;
  REVOKE ALL ON TABLE public.berufski_corporate_commerce FROM anon, authenticated;
  REVOKE ALL ON TABLE public.berufski_affiliate_payouts FROM anon, authenticated;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
