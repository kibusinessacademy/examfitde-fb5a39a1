
-- Insert published packages into seo_discovery_state using course title as slug
INSERT INTO public.seo_discovery_state (source_type, source_id, canonical_url, is_indexable, in_sitemap, in_feed, content_status)
SELECT 
  'product',
  cp.id,
  'https://examfit.de/kurs/' || lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(c.title, '[äÄ]', 'ae', 'g'),
        '[öÖ]', 'oe', 'g'
      ),
      '[üÜ]', 'ue', 'g'
    )
  ),
  true,
  true,
  false,
  'published'
FROM course_packages cp
JOIN courses c ON c.id = cp.course_id
WHERE cp.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM seo_discovery_state sd 
    WHERE sd.source_type = 'product' AND sd.source_id = cp.id
  );
