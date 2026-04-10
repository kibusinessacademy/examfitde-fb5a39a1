
-- Fix product URLs to be proper slugs
UPDATE public.seo_discovery_state
SET canonical_url = 'https://examfit.de/kurs/' || 
  regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                split_part(canonical_url, '/kurs/', 2),
                '[äÄ]', 'ae', 'g'
              ),
              '[öÖ]', 'oe', 'g'
            ),
            '[üÜ]', 'ue', 'g'
          )
        ),
        '[^a-z0-9]+', '-', 'g'
      ),
      '^-+|-+$', '', 'g'
    ),
    '--+', '-', 'g'
  )
WHERE source_type = 'product';
