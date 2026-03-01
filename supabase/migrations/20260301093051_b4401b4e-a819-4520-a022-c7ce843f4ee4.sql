
-- Migration 011: Remove all legacy berufski_* compatibility views
-- Pre-condition: Code audit confirmed 0 references to berufski_* in src/ and edge functions

-- Drop legacy compatibility views (all are simple SELECT * FROM work_* views)
DROP VIEW IF EXISTS public.berufski_produkte CASCADE;
DROP VIEW IF EXISTS public.berufski_purchases CASCADE;
DROP VIEW IF EXISTS public.berufski_email_outbox CASCADE;
DROP VIEW IF EXISTS public.berufski_coupons CASCADE;
DROP VIEW IF EXISTS public.berufski_coupon_redemptions CASCADE;
DROP VIEW IF EXISTS public.berufski_articles CASCADE;
DROP VIEW IF EXISTS public.berufski_berufe CASCADE;
DROP VIEW IF EXISTS public.berufski_cover_assets CASCADE;
DROP VIEW IF EXISTS public.berufski_brand_themes CASCADE;
DROP VIEW IF EXISTS public.berufski_pdf_templates CASCADE;
DROP VIEW IF EXISTS public.berufski_pdf_exports CASCADE;
DROP VIEW IF EXISTS public.berufski_bundles CASCADE;
DROP VIEW IF EXISTS public.berufski_bundle_assets CASCADE;
DROP VIEW IF EXISTS public.berufski_bundle_purchases CASCADE;
DROP VIEW IF EXISTS public.berufski_organizations CASCADE;
DROP VIEW IF EXISTS public.berufski_org_members CASCADE;
DROP VIEW IF EXISTS public.berufski_licenses CASCADE;
DROP VIEW IF EXISTS public.berufski_license_keys CASCADE;
DROP VIEW IF EXISTS public.berufski_license_events CASCADE;
DROP VIEW IF EXISTS public.berufski_corporate_commerce CASCADE;
DROP VIEW IF EXISTS public.berufski_affiliates CASCADE;
DROP VIEW IF EXISTS public.berufski_affiliate_clicks CASCADE;
DROP VIEW IF EXISTS public.berufski_affiliate_payouts CASCADE;
DROP VIEW IF EXISTS public.berufski_v_affiliate_sales CASCADE;

-- Drop legacy compat trigger functions (if they still exist from earlier migrations)
DROP FUNCTION IF EXISTS public._compat_insert_berufski_purchases() CASCADE;
DROP FUNCTION IF EXISTS public._compat_insert_berufski_email_outbox() CASCADE;
DROP FUNCTION IF EXISTS public._compat_insert_berufski_coupon_redemptions() CASCADE;

-- Drop legacy RPCs (replaced by work_* equivalents)
DROP FUNCTION IF EXISTS public.berufski_increment_coupon_redeemed(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.berufski_set_updated_at() CASCADE;

-- Verification: assert no legacy objects remain
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*) INTO cnt
  FROM pg_views
  WHERE schemaname = 'public' AND viewname LIKE 'berufski\_%' ESCAPE '\';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'Legacy views still exist: % remaining', cnt;
  END IF;

  SELECT count(*) INTO cnt
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename LIKE 'berufski\_%' ESCAPE '\';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'Legacy tables still exist: % remaining', cnt;
  END IF;
END $$;
