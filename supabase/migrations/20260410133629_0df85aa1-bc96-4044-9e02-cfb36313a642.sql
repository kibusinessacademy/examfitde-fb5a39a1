
-- 1. Link Stripe Product IDs to store_products
UPDATE public.store_products 
SET stripe_product_id = 'prod_UH23yo0jgXIbNd'
WHERE product_key = 'exam_trainer';

UPDATE public.store_products 
SET stripe_product_id = 'prod_UH24Yk5oIBanfl'
WHERE product_key = 'learning_course';

UPDATE public.store_products 
SET stripe_product_id = 'prod_UH23yo0jgXIbNd'
WHERE product_key = 'bundle';

-- 2. Insert all published blog articles into seo_discovery_state
INSERT INTO public.seo_discovery_state (source_type, source_id, canonical_url, is_indexable, in_sitemap, in_feed, content_status)
SELECT 
  'blog_post',
  ba.id,
  'https://examfit.de/blog/' || ba.slug,
  true,
  true,
  true,
  'published'
FROM blog_articles ba
WHERE ba.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM seo_discovery_state sd 
    WHERE sd.source_type = 'blog_post' AND sd.source_id = ba.id
  );

-- 3. Insert all published course packages into seo_discovery_state using product slug
INSERT INTO public.seo_discovery_state (source_type, source_id, canonical_url, is_indexable, in_sitemap, in_feed, content_status)
SELECT 
  'product',
  cp.id,
  'https://examfit.de/kurs/' || p.slug,
  true,
  true,
  false,
  'published'
FROM course_packages cp
JOIN products p ON p.active_package_id = cp.id
WHERE cp.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM seo_discovery_state sd 
    WHERE sd.source_type = 'product' AND sd.source_id = cp.id
  );
