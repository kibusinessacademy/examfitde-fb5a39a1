-- P75 — Premium Shop Catalog: Nachfrage-Sortierung + Top-Level Kategorie
-- SSOT_FIRST: liest weiterhin nur aus v_public_sellable_courses + certification_catalog.
-- Ergänzt demand_score (priority_score, Basis der bestehenden Keyword-/SEO-Recherche)
-- und category (Ausbildung / Weiterbildung / Zertifizierung) für die Shop-Filter.

CREATE OR REPLACE FUNCTION public.public_sellable_course_catalog()
RETURNS TABLE(
  course_id uuid,
  curriculum_id uuid,
  package_id uuid,
  title text,
  product_slug text,
  product_id uuid,
  min_price_cents integer,
  currency text,
  track text,
  chamber_type text,
  catalog_type text,
  category text,
  demand_score numeric,
  certification_slug text,
  modules integer,
  lessons integer,
  lessons_ready integer,
  published_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    v.course_id,
    v.curriculum_id,
    cp.id AS package_id,
    v.course_title AS title,
    v.product_slug,
    v.product_id,
    v.min_price_cents,
    v.currency,
    COALESCE(cp.track, 'EXAM_FIRST') AS track,
    COALESCE(cat.chamber_type, 'IHK') AS chamber_type,
    COALESCE(cat.catalog_type, 'Ausbildung') AS catalog_type,
    CASE COALESCE(cat.catalog_type, 'Ausbildung')
      WHEN 'Ausbildung' THEN 'Ausbildung'
      WHEN 'Fortbildung_IHK' THEN 'Weiterbildung'
      WHEN 'Fortbildung_HWK' THEN 'Weiterbildung'
      WHEN 'Meister' THEN 'Weiterbildung'
      WHEN 'Studium' THEN 'Weiterbildung'
      ELSE 'Zertifizierung'
    END AS category,
    COALESCE(cat.priority_score, 50) AS demand_score,
    cat.slug AS certification_slug,
    v.modules,
    v.lessons,
    v.lessons_ready,
    v.published_at
  FROM v_public_sellable_courses v
  LEFT JOIN course_packages cp ON cp.curriculum_id = v.curriculum_id AND cp.status = 'published'
  LEFT JOIN curricula cu ON cu.id = v.curriculum_id
  LEFT JOIN certification_catalog cat ON cat.id = cu.certification_id
  WHERE v.is_sellable = true
  ORDER BY COALESCE(cat.priority_score, 50) DESC, v.course_title;
$$;

GRANT EXECUTE ON FUNCTION public.public_sellable_course_catalog() TO anon, authenticated;

COMMENT ON FUNCTION public.public_sellable_course_catalog() IS
  'P75 — Public shop catalog. category groups catalog_type into Ausbildung/Weiterbildung/Zertifizierung. demand_score = certification_catalog.priority_score (Marktnachfrage-Proxy), Default-Sortierung absteigend.';

-- Smoke (informational)
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM public.public_sellable_course_catalog();
  RAISE NOTICE 'P75 catalog rows: %', n;
END $$;
