-- Pricing Regression Guard: aggregiert die Drift-Indikatoren in eine kleine
-- 1-Zeilen-View, die im Cockpit als Ampel angezeigt werden kann.
CREATE OR REPLACE VIEW public.v_pricing_integrity_check AS
SELECT
  count(*) FILTER (WHERE existing_active_price_id IS NULL)            AS published_without_price,
  count(*) FILTER (WHERE action_needed = 'merge_duplicate_products')  AS duplicate_product_cases,
  count(*) FILTER (WHERE action_needed = 'manual_review')             AS manual_review_cases,
  count(*)                                                            AS total_published_packages,
  CASE
    WHEN count(*) FILTER (WHERE existing_active_price_id IS NULL) = 0
     AND count(*) FILTER (WHERE action_needed = 'merge_duplicate_products') = 0
     AND count(*) FILTER (WHERE action_needed = 'manual_review') = 0
    THEN 'green'
    WHEN count(*) FILTER (WHERE existing_active_price_id IS NULL) > 0
    THEN 'red'
    ELSE 'yellow'
  END AS status,
  now() AS checked_at
FROM public.v_pricing_backfill_dryrun;

COMMENT ON VIEW public.v_pricing_integrity_check IS
  'Pricing Regression Guard. Zielzustand: published_without_price=0, duplicate_product_cases=0, manual_review_cases=0. Quelle: v_pricing_backfill_dryrun.';

GRANT SELECT ON public.v_pricing_integrity_check TO authenticated;