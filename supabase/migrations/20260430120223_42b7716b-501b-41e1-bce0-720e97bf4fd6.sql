DROP VIEW IF EXISTS public.v_pricing_backfill_dryrun;

CREATE VIEW public.v_pricing_backfill_dryrun AS
WITH base AS (
  SELECT 
    cp.id           AS package_id,
    cp.title        AS package_title,
    cp.status       AS package_status,
    cp.certification_id,
    c.title         AS certification_title
  FROM course_packages cp
  LEFT JOIN certifications c ON c.id = cp.certification_id
  WHERE cp.status = 'published'
),
products_per_pkg AS (
  SELECT 
    b.package_id,
    p.id AS product_id,
    p.title AS product_title,
    EXISTS (SELECT 1 FROM product_prices pp 
            WHERE pp.product_id = p.id AND pp.active = true) AS has_active_price,
    (SELECT pp.id FROM product_prices pp 
       WHERE pp.product_id = p.id AND pp.active = true 
       ORDER BY pp.created_at DESC LIMIT 1) AS active_price_id,
    (SELECT pp.amount_cents FROM product_prices pp 
       WHERE pp.product_id = p.id AND pp.active = true 
       ORDER BY pp.created_at DESC LIMIT 1) AS active_price_cents
  FROM base b
  LEFT JOIN products p 
    ON (p.active_package_id = b.package_id OR p.certification_id = b.certification_id)
   AND p.id IS NOT NULL
),
chosen AS (
  SELECT 
    package_id,
    count(DISTINCT product_id) FILTER (WHERE product_id IS NOT NULL) AS product_count,
    (array_agg(product_id ORDER BY has_active_price DESC NULLS LAST, product_title))[1] AS chosen_product_id,
    bool_or(has_active_price) AS any_priced,
    (array_agg(active_price_id ORDER BY has_active_price DESC NULLS LAST, product_title))[1] AS chosen_active_price_id,
    (array_agg(active_price_cents ORDER BY has_active_price DESC NULLS LAST, product_title))[1] AS chosen_active_price_cents
  FROM products_per_pkg
  GROUP BY package_id
),
classified AS (
  SELECT b.*,
         ch.product_count,
         ch.chosen_product_id    AS existing_product_id,
         ch.chosen_active_price_id AS existing_active_price_id,
         ch.chosen_active_price_cents AS existing_active_price_cents,
         cls.tier_key            AS auto_tier,
         cls.price_cents         AS auto_price_cents,
         cls.confidence          AS auto_confidence,
         cls.reason              AS auto_reason
    FROM base b
    LEFT JOIN chosen ch ON ch.package_id = b.package_id
    LEFT JOIN LATERAL public.classify_package_pricing_tier(b.certification_title) cls ON true
),
merged AS (
  SELECT 
    cf.*,
    o.forced_tier,
    o.forced_price_cents,
    o.forced_action,
    o.note AS override_note,
    COALESCE(o.forced_tier, cf.auto_tier) AS suggested_tier,
    COALESCE(
      o.forced_price_cents,
      (SELECT t.price_cents FROM product_pricing_tiers t WHERE t.tier_key = o.forced_tier),
      cf.auto_price_cents
    ) AS suggested_price_cents,
    CASE 
      WHEN o.forced_tier IS NOT NULL OR o.forced_price_cents IS NOT NULL THEN 'override'
      ELSE cf.auto_confidence
    END AS confidence,
    CASE 
      WHEN o.forced_tier IS NOT NULL OR o.forced_price_cents IS NOT NULL 
        THEN 'manual override: ' || COALESCE(o.note,'(no note)')
      ELSE cf.auto_reason
    END AS reason
  FROM classified cf
  LEFT JOIN product_pricing_overrides o ON o.package_id = cf.package_id
)
SELECT 
  package_id,
  package_title,
  package_status,
  certification_id,
  certification_title,
  suggested_tier,
  suggested_price_cents,
  confidence,
  reason,
  forced_tier,
  forced_price_cents,
  override_note,
  product_count,
  existing_product_id,
  existing_active_price_id,
  existing_active_price_cents,
  CASE
    WHEN forced_action = 'skip'                                  THEN 'skip'
    WHEN forced_action IS NOT NULL                               THEN forced_action
    WHEN existing_active_price_id IS NOT NULL 
         AND product_count = 1                                   THEN 'none'
    WHEN existing_active_price_id IS NOT NULL 
         AND product_count > 1                                   THEN 'merge_duplicate_products'
    WHEN suggested_tier IS NULL                                  THEN 'manual_review'
    WHEN existing_product_id IS NOT NULL 
         AND existing_active_price_id IS NULL                    THEN 'create_price_only'
    WHEN existing_product_id IS NULL                             THEN 'create_product_and_price'
    WHEN confidence = 'low'                                      THEN 'manual_review'
    ELSE 'manual_review'
  END AS action_needed
FROM merged
ORDER BY 
  CASE 
    WHEN confidence = 'none' THEN 1
    WHEN confidence = 'low'  THEN 2
    ELSE 3 
  END,
  package_title;

GRANT SELECT ON public.v_pricing_backfill_dryrun TO authenticated;