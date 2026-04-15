
CREATE OR REPLACE VIEW public.v_full_course_catalog AS
SELECT
  b.id AS beruf_id,
  b.bezeichnung_kurz AS title,
  b.bezeichnung_lang AS title_long,
  b.zustaendigkeit,
  b.ausbildungsdauer_monate,
  b.dqr_niveau,
  LOWER(REGEXP_REPLACE(REGEXP_REPLACE(b.bezeichnung_kurz, '[^a-zA-Z0-9äöüÄÖÜß\s-]', '', 'g'), '\s+', '-', 'g')) AS slug,
  CASE 
    WHEN b.zustaendigkeit = 'IH' THEN 'IHK'
    WHEN b.zustaendigkeit = 'Hw' THEN 'HWK'
    ELSE b.zustaendigkeit
  END AS kammer,
  hc.package_id,
  hc.published_at IS NOT NULL AS is_published,
  hc.category,
  hc.category_label,
  hc.description,
  hc.discovery_teaser,
  hc.popularity_score,
  hc.slug AS published_slug
FROM berufe b
LEFT JOIN v_homepage_course_catalog hc ON hc.beruf_id = b.id
WHERE b.ist_aktiv = true
ORDER BY b.bezeichnung_kurz;

-- Allow public read access
GRANT SELECT ON public.v_full_course_catalog TO anon, authenticated;
