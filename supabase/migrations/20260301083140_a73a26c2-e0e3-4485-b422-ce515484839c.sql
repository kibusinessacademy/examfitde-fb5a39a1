
-- ============================================================
-- PHASE 1: Rename all berufski_* tables to work_*
-- ============================================================
ALTER TABLE public.berufski_affiliate_clicks RENAME TO work_affiliate_clicks;
ALTER TABLE public.berufski_affiliate_payouts RENAME TO work_affiliate_payouts;
ALTER TABLE public.berufski_affiliates RENAME TO work_affiliates;
ALTER TABLE public.berufski_articles RENAME TO work_articles;
ALTER TABLE public.berufski_berufe RENAME TO work_berufe;
ALTER TABLE public.berufski_brand_themes RENAME TO work_brand_themes;
ALTER TABLE public.berufski_bundle_assets RENAME TO work_bundle_assets;
ALTER TABLE public.berufski_bundle_purchases RENAME TO work_bundle_purchases;
ALTER TABLE public.berufski_bundles RENAME TO work_bundles;
ALTER TABLE public.berufski_corporate_commerce RENAME TO work_corporate_commerce;
ALTER TABLE public.berufski_coupon_redemptions RENAME TO work_coupon_redemptions;
ALTER TABLE public.berufski_coupons RENAME TO work_coupons;
ALTER TABLE public.berufski_cover_assets RENAME TO work_cover_assets;
ALTER TABLE public.berufski_email_outbox RENAME TO work_email_outbox;
ALTER TABLE public.berufski_license_events RENAME TO work_license_events;
ALTER TABLE public.berufski_license_keys RENAME TO work_license_keys;
ALTER TABLE public.berufski_licenses RENAME TO work_licenses;
ALTER TABLE public.berufski_org_members RENAME TO work_org_members;
ALTER TABLE public.berufski_organizations RENAME TO work_organizations;
ALTER TABLE public.berufski_pdf_exports RENAME TO work_pdf_exports;
ALTER TABLE public.berufski_pdf_templates RENAME TO work_pdf_templates;
ALTER TABLE public.berufski_produkte RENAME TO work_produkte;
ALTER TABLE public.berufski_purchases RENAME TO work_purchases;

-- ============================================================
-- PHASE 2: Drop old view and recreate with new table names
-- ============================================================
DROP VIEW IF EXISTS public.berufski_v_affiliate_sales;

CREATE VIEW public.work_v_affiliate_sales AS
SELECT a.code AS affiliate_code,
    a.name AS affiliate_name,
    a.payout_percent,
    'eur'::text AS currency,
    count(DISTINCT p.id) AS product_orders,
    COALESCE(sum(p.amount_cents), 0::bigint) AS product_revenue_cents,
    count(DISTINCT bp.id) AS bundle_orders,
    COALESCE(sum(bp.amount_paid_cents), 0::bigint) AS bundle_revenue_cents,
    (COALESCE(sum(p.amount_cents), 0::bigint) + COALESCE(sum(bp.amount_paid_cents), 0::bigint)) AS total_revenue_cents,
    (round(((COALESCE(sum(p.amount_cents), 0::bigint) + COALESCE(sum(bp.amount_paid_cents), 0::bigint))::numeric * a.payout_percent) / 100.0))::bigint AS est_commission_cents
FROM work_affiliates a
LEFT JOIN work_purchases p ON p.affiliate_code = a.code
LEFT JOIN work_bundle_purchases bp ON bp.affiliate_code = a.code
GROUP BY a.code, a.name, a.payout_percent;

-- ============================================================
-- PHASE 3: Create new RPC functions with work_* names
-- ============================================================
CREATE OR REPLACE FUNCTION public.work_increment_coupon_redeemed(p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.work_coupons SET redeemed_count = redeemed_count + 1 WHERE code = p_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.work_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Update existing trigger functions to reference new table names
CREATE OR REPLACE FUNCTION public.berufski_increment_coupon_redeemed(p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.work_coupons SET redeemed_count = redeemed_count + 1 WHERE code = p_code;
END;
$$;

-- ============================================================
-- PHASE 4: Create backward-compat views (old names → new tables)
-- These are simple auto-updatable views in PostgreSQL 15+
-- ============================================================
CREATE VIEW public.berufski_affiliate_clicks AS SELECT * FROM public.work_affiliate_clicks;
CREATE VIEW public.berufski_affiliate_payouts AS SELECT * FROM public.work_affiliate_payouts;
CREATE VIEW public.berufski_affiliates AS SELECT * FROM public.work_affiliates;
CREATE VIEW public.berufski_articles AS SELECT * FROM public.work_articles;
CREATE VIEW public.berufski_berufe AS SELECT * FROM public.work_berufe;
CREATE VIEW public.berufski_brand_themes AS SELECT * FROM public.work_brand_themes;
CREATE VIEW public.berufski_bundle_assets AS SELECT * FROM public.work_bundle_assets;
CREATE VIEW public.berufski_bundle_purchases AS SELECT * FROM public.work_bundle_purchases;
CREATE VIEW public.berufski_bundles AS SELECT * FROM public.work_bundles;
CREATE VIEW public.berufski_corporate_commerce AS SELECT * FROM public.work_corporate_commerce;
CREATE VIEW public.berufski_coupon_redemptions AS SELECT * FROM public.work_coupon_redemptions;
CREATE VIEW public.berufski_coupons AS SELECT * FROM public.work_coupons;
CREATE VIEW public.berufski_cover_assets AS SELECT * FROM public.work_cover_assets;
CREATE VIEW public.berufski_email_outbox AS SELECT * FROM public.work_email_outbox;
CREATE VIEW public.berufski_license_events AS SELECT * FROM public.work_license_events;
CREATE VIEW public.berufski_license_keys AS SELECT * FROM public.work_license_keys;
CREATE VIEW public.berufski_licenses AS SELECT * FROM public.work_licenses;
CREATE VIEW public.berufski_org_members AS SELECT * FROM public.work_org_members;
CREATE VIEW public.berufski_organizations AS SELECT * FROM public.work_organizations;
CREATE VIEW public.berufski_pdf_exports AS SELECT * FROM public.work_pdf_exports;
CREATE VIEW public.berufski_pdf_templates AS SELECT * FROM public.work_pdf_templates;
CREATE VIEW public.berufski_produkte AS SELECT * FROM public.work_produkte;
CREATE VIEW public.berufski_purchases AS SELECT * FROM public.work_purchases;
CREATE VIEW public.berufski_v_affiliate_sales AS SELECT * FROM public.work_v_affiliate_sales;
