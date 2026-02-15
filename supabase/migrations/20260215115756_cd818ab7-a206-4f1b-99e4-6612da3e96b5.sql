
-- 1) Add certification_level to store_products for level-based pricing
ALTER TABLE public.store_products
  ADD COLUMN IF NOT EXISTS certification_level text DEFAULT 'ausbildung';

COMMENT ON COLUMN public.store_products.certification_level IS 'ausbildung | fachwirt | meister | betriebswirt | sachkunde | aevo';

-- 2) Add bloom_distribution config to certification_catalog
ALTER TABLE public.certification_catalog
  ADD COLUMN IF NOT EXISTS bloom_distribution jsonb;

COMMENT ON COLUMN public.certification_catalog.bloom_distribution IS 'Bloom taxonomy distribution per level: {remember, understand, apply, analyze, evaluate, create}';

-- 3) Set default bloom distributions based on certification_level
UPDATE public.certification_catalog
SET bloom_distribution = CASE
  WHEN certification_level IN ('ausbildung') OR certification_level IS NULL THEN
    '{"remember": 0.10, "understand": 0.20, "apply": 0.40, "analyze": 0.20, "evaluate": 0.08, "create": 0.02}'::jsonb
  WHEN certification_level IN ('fachwirt') THEN
    '{"remember": 0.05, "understand": 0.10, "apply": 0.25, "analyze": 0.35, "evaluate": 0.20, "create": 0.05}'::jsonb
  WHEN certification_level IN ('meister') THEN
    '{"remember": 0.03, "understand": 0.07, "apply": 0.20, "analyze": 0.30, "evaluate": 0.30, "create": 0.10}'::jsonb
  WHEN certification_level IN ('betriebswirt') THEN
    '{"remember": 0.02, "understand": 0.05, "apply": 0.15, "analyze": 0.28, "evaluate": 0.35, "create": 0.15}'::jsonb
  WHEN certification_level IN ('sachkunde') THEN
    '{"remember": 0.15, "understand": 0.25, "apply": 0.35, "analyze": 0.15, "evaluate": 0.08, "create": 0.02}'::jsonb
  ELSE
    '{"remember": 0.10, "understand": 0.20, "apply": 0.35, "analyze": 0.20, "evaluate": 0.12, "create": 0.03}'::jsonb
END
WHERE bloom_distribution IS NULL;

-- 4) Pricing view: level-aware price recommendation
CREATE OR REPLACE VIEW public.v_level_pricing AS
SELECT
  sp.id AS product_id,
  sp.product_key,
  sp.name AS product_name,
  sp.certification_level,
  ppt.min_quantity,
  ppt.max_quantity,
  ppt.price_cents,
  CASE sp.certification_level
    WHEN 'ausbildung'   THEN ppt.price_cents
    WHEN 'fachwirt'     THEN GREATEST(ppt.price_cents, 14900)
    WHEN 'meister'      THEN GREATEST(ppt.price_cents, 19900)
    WHEN 'betriebswirt' THEN GREATEST(ppt.price_cents, 24900)
    WHEN 'sachkunde'    THEN GREATEST(ppt.price_cents, 9900)
    WHEN 'aevo'         THEN GREATEST(ppt.price_cents, 7900)
    ELSE ppt.price_cents
  END AS recommended_price_cents
FROM public.store_products sp
LEFT JOIN public.product_price_tiers ppt ON ppt.product_id = sp.id
WHERE sp.is_active = true;
