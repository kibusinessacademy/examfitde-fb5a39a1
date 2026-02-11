
-- Council 8: Finance / Controlling — ALL tables, views, RPCs in correct order

-- ============ ENUMS ============
DO $$ BEGIN CREATE TYPE public.finance_event_type AS ENUM ('order_created','payment_succeeded','payment_failed','refund_created','chargeback','invoice_issued'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.finance_source AS ENUM ('app','stripe'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.finance_export_status AS ENUM ('queued','generated','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ TABLES ============
CREATE TABLE IF NOT EXISTS public.stripe_event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  livemode boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL
);
ALTER TABLE public.stripe_event_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_stripe_event_log ON public.stripe_event_log FOR ALL USING (false);
CREATE POLICY admin_all_stripe_event_log ON public.stripe_event_log FOR ALL USING (public.is_admin_user(auth.uid()));

CREATE TABLE IF NOT EXISTS public.finance_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type public.finance_event_type NOT NULL,
  source public.finance_source NOT NULL DEFAULT 'app',
  order_id uuid NULL,
  stripe_payment_intent_id text NULL,
  stripe_charge_id text NULL,
  stripe_invoice_id text NULL,
  currency text NOT NULL DEFAULT 'eur',
  amount_gross_cents int NOT NULL DEFAULT 0,
  amount_net_cents int NOT NULL DEFAULT 0,
  tax_cents int NOT NULL DEFAULT 0,
  tax_rate numeric NULL,
  tax_country text NULL,
  customer_type text NULL CHECK (customer_type IN ('b2c','b2b')),
  buyer_account_id uuid NULL,
  learner_user_id uuid NULL,
  description text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_finance_ledger_occurred ON public.finance_ledger(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_ledger_order ON public.finance_ledger(order_id);
ALTER TABLE public.finance_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_finance_ledger ON public.finance_ledger FOR ALL USING (false);
CREATE POLICY admin_all_finance_ledger ON public.finance_ledger FOR ALL USING (public.is_admin_user(auth.uid()));

CREATE TABLE IF NOT EXISTS public.finance_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_type text NOT NULL,
  period_month date NULL,
  currency text NOT NULL DEFAULT 'eur',
  status public.finance_export_status NOT NULL DEFAULT 'queued',
  file_path text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  generated_at timestamptz NULL
);
ALTER TABLE public.finance_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_finance_exports ON public.finance_exports FOR ALL USING (false);
CREATE POLICY admin_all_finance_exports ON public.finance_exports FOR ALL USING (public.is_admin_user(auth.uid()));

CREATE TABLE IF NOT EXISTS public.datev_export_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'default',
  revenue_account text NOT NULL DEFAULT '8400',
  tax_account text NOT NULL DEFAULT '1776',
  receivable_account text NOT NULL DEFAULT '1200',
  currency text NOT NULL DEFAULT 'EUR',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(name)
);
ALTER TABLE public.datev_export_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_datev_export_config ON public.datev_export_config FOR ALL USING (false);
CREATE POLICY admin_all_datev_export_config ON public.datev_export_config FOR ALL USING (public.is_admin_user(auth.uid()));
INSERT INTO public.datev_export_config(name) VALUES ('default') ON CONFLICT (name) DO NOTHING;

-- Orders: add optional columns
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_rate numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_country text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_type text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS buyer_account_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS learner_user_id uuid;
CREATE INDEX IF NOT EXISTS idx_orders_stripe_pi ON public.orders(stripe_payment_intent_id);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('finance-exports', 'finance-exports', false) ON CONFLICT (id) DO NOTHING;
CREATE POLICY admin_finance_exports_select ON storage.objects FOR SELECT USING (bucket_id = 'finance-exports' AND (SELECT public.is_admin_user(auth.uid())));
CREATE POLICY admin_finance_exports_insert ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'finance-exports' AND (SELECT public.is_admin_user(auth.uid())));

-- ============ HELPER FUNCTIONS (no table dependencies) ============
CREATE OR REPLACE FUNCTION public.month_start(p_any date) RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT date_trunc('month', p_any)::date; $$;
CREATE OR REPLACE FUNCTION public.cents_to_de_decimal(p_cents bigint) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT replace(to_char((p_cents::numeric / 100.0), 'FM9999999990.00'), '.', ','); $$;

-- ============ VIEWS ============
CREATE OR REPLACE VIEW public.v_revenue_daily AS
SELECT date_trunc('day', occurred_at) AS day, currency, sum(amount_gross_cents) AS gross_cents, sum(amount_net_cents) AS net_cents, sum(tax_cents) AS tax_cents, count(*) FILTER (WHERE event_type = 'payment_succeeded') AS payments
FROM public.finance_ledger WHERE event_type IN ('payment_succeeded','refund_created','chargeback') GROUP BY 1,2 ORDER BY 1 DESC;

CREATE OR REPLACE VIEW public.v_vat_monthly AS
SELECT date_trunc('month', occurred_at) AS month, tax_country, tax_rate, currency, sum(amount_net_cents) AS net_cents, sum(tax_cents) AS tax_cents, sum(amount_gross_cents) AS gross_cents
FROM public.finance_ledger WHERE event_type = 'payment_succeeded' GROUP BY 1,2,3,4 ORDER BY 1 DESC;

-- ============ RPCs ============
CREATE OR REPLACE FUNCTION public.get_revenue_summary(p_from date, p_to date)
RETURNS TABLE (day date, currency text, gross_cents bigint, net_cents bigint, tax_cents bigint, payments bigint)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT (v.day)::date, v.currency, v.gross_cents::bigint, v.net_cents::bigint, v.tax_cents::bigint, v.payments::bigint
  FROM public.v_revenue_daily v WHERE (v.day)::date >= p_from AND (v.day)::date <= p_to ORDER BY v.day DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_reconcile_gaps(p_limit int DEFAULT 50)
RETURNS TABLE (order_id uuid, order_created_at timestamptz, stripe_payment_intent_id text, has_payment_succeeded boolean)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT o.id, o.created_at, o.stripe_payment_intent_id,
    EXISTS (SELECT 1 FROM public.finance_ledger l WHERE l.order_id = o.id AND l.event_type = 'payment_succeeded')
  FROM public.orders o WHERE o.stripe_payment_intent_id IS NOT NULL ORDER BY o.created_at DESC LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.get_monthly_revenue_lines(p_month date, p_currency text DEFAULT 'eur')
RETURNS TABLE (occurred_day date, gross_cents bigint, net_cents bigint, tax_cents bigint, payments bigint, refunds bigint)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT date_trunc('day', l.occurred_at)::date, SUM(l.amount_gross_cents)::bigint, SUM(l.amount_net_cents)::bigint, SUM(l.tax_cents)::bigint,
    COUNT(*) FILTER (WHERE l.event_type='payment_succeeded')::bigint, COUNT(*) FILTER (WHERE l.event_type IN ('refund_created','chargeback'))::bigint
  FROM public.finance_ledger l
  WHERE l.occurred_at >= date_trunc('month', p_month) AND l.occurred_at < (date_trunc('month', p_month) + interval '1 month') AND l.currency = p_currency
    AND l.event_type IN ('payment_succeeded','refund_created','chargeback') GROUP BY 1 ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.get_monthly_vat_lines(p_month date, p_currency text DEFAULT 'eur')
RETURNS TABLE (tax_country text, tax_rate numeric, net_cents bigint, tax_cents bigint, gross_cents bigint, payments bigint)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(l.tax_country,'unknown'), COALESCE(l.tax_rate,0), SUM(l.amount_net_cents)::bigint, SUM(l.tax_cents)::bigint, SUM(l.amount_gross_cents)::bigint, COUNT(*)::bigint
  FROM public.finance_ledger l
  WHERE l.occurred_at >= date_trunc('month', p_month) AND l.occurred_at < (date_trunc('month', p_month) + interval '1 month') AND l.currency = p_currency AND l.event_type = 'payment_succeeded'
  GROUP BY 1,2 ORDER BY 1,2;
$$;

CREATE OR REPLACE FUNCTION public.get_b2b_buyer_learner_summary(p_month date, p_currency text DEFAULT 'eur')
RETURNS TABLE (buyer_account_id uuid, learner_user_id uuid, payments bigint, gross_cents bigint, net_cents bigint, tax_cents bigint)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT l.buyer_account_id, l.learner_user_id, COUNT(*)::bigint, SUM(l.amount_gross_cents)::bigint, SUM(l.amount_net_cents)::bigint, SUM(l.tax_cents)::bigint
  FROM public.finance_ledger l
  WHERE l.occurred_at >= date_trunc('month', p_month) AND l.occurred_at < (date_trunc('month', p_month) + interval '1 month') AND l.currency = p_currency
    AND l.customer_type = 'b2b' AND l.event_type = 'payment_succeeded' GROUP BY 1,2 ORDER BY 4 DESC;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_finance_export(p_export_type text, p_month date, p_currency text DEFAULT 'eur')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.finance_exports(export_type, period_month, currency, status) VALUES (p_export_type, public.month_start(p_month), p_currency, 'queued') RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.get_monthly_refund_kpi(p_month date, p_currency text DEFAULT 'eur')
RETURNS TABLE (month date, payments bigint, refunds bigint, gross_sales_cents bigint, refund_cents bigint, refund_rate numeric)
LANGUAGE sql SECURITY DEFINER AS $$
  WITH agg AS (
    SELECT COUNT(*) FILTER (WHERE event_type='payment_succeeded') AS payments,
      COUNT(*) FILTER (WHERE event_type IN ('refund_created','chargeback')) AS refunds,
      SUM(amount_gross_cents) FILTER (WHERE event_type='payment_succeeded') AS gross_sales_cents,
      ABS(COALESCE(SUM(amount_gross_cents) FILTER (WHERE event_type IN ('refund_created','chargeback')), 0)) AS refund_cents
    FROM public.finance_ledger l
    WHERE l.occurred_at >= date_trunc('month', p_month) AND l.occurred_at < (date_trunc('month', p_month) + interval '1 month') AND l.currency = p_currency
      AND l.event_type IN ('payment_succeeded','refund_created','chargeback')
  )
  SELECT date_trunc('month', p_month)::date, COALESCE(payments,0)::bigint, COALESCE(refunds,0)::bigint,
    COALESCE(gross_sales_cents,0)::bigint, COALESCE(refund_cents,0)::bigint,
    CASE WHEN COALESCE(gross_sales_cents,0)=0 THEN 0 ELSE (COALESCE(refund_cents,0)::numeric / COALESCE(gross_sales_cents,0)::numeric) END
  FROM agg;
$$;

CREATE OR REPLACE FUNCTION public.get_reconcile_gaps_details(p_limit int DEFAULT 100)
RETURNS TABLE (order_id uuid, created_at timestamptz, stripe_payment_intent_id text, currency text, total_cents int, has_payment_succeeded boolean, has_order_created boolean)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT o.id, o.created_at, o.stripe_payment_intent_id, o.currency, o.total_cents,
    EXISTS (SELECT 1 FROM public.finance_ledger l WHERE l.order_id = o.id AND l.event_type = 'payment_succeeded'),
    EXISTS (SELECT 1 FROM public.finance_ledger l WHERE l.order_id = o.id AND l.event_type = 'order_created')
  FROM public.orders o WHERE o.stripe_payment_intent_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.finance_ledger l WHERE l.order_id = o.id AND l.event_type = 'payment_succeeded')
  ORDER BY o.created_at DESC LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.get_datev_prep_lines(p_month date, p_currency text DEFAULT 'eur', p_config_name text DEFAULT 'default')
RETURNS TABLE (belegdatum date, belegfeld1 text, buchungstext text, konto text, gegenkonto text, steuer_schluessel text, betrag text, waehrung text, order_id uuid, payment_intent text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE cfg record; m0 date; m1 date;
BEGIN
  SELECT * INTO cfg FROM public.datev_export_config WHERE name = p_config_name AND enabled = true LIMIT 1;
  IF cfg IS NULL THEN RAISE EXCEPTION 'No enabled datev_export_config for name=%', p_config_name; END IF;
  m0 := date_trunc('month', p_month)::date; m1 := (m0 + interval '1 month')::date;
  RETURN QUERY
  SELECT date_trunc('day', l.occurred_at)::date, COALESCE(l.stripe_payment_intent_id, l.stripe_charge_id, l.order_id::text),
    CASE WHEN l.event_type='payment_succeeded' THEN 'Online-Kurs Verkauf' WHEN l.event_type='refund_created' THEN 'Rückerstattung' WHEN l.event_type='chargeback' THEN 'Chargeback' ELSE 'Finance' END,
    CASE WHEN l.event_type='payment_succeeded' THEN cfg.receivable_account ELSE cfg.revenue_account END,
    CASE WHEN l.event_type='payment_succeeded' THEN cfg.revenue_account ELSE cfg.receivable_account END,
    CASE WHEN COALESCE(l.tax_rate,0)=0 THEN '0' WHEN COALESCE(l.tax_rate,0)>=0.19 THEN '19' ELSE '7' END,
    public.cents_to_de_decimal(l.amount_gross_cents::bigint), upper(cfg.currency), l.order_id, l.stripe_payment_intent_id
  FROM public.finance_ledger l WHERE l.occurred_at >= m0 AND l.occurred_at < m1 AND l.currency = p_currency
    AND l.event_type IN ('payment_succeeded','refund_created','chargeback') ORDER BY 1, 2;
END $$;
