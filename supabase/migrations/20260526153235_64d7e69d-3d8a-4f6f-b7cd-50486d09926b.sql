
-- P74a — Public Sellable Courses Catalog RPC
-- SSOT_FIRST: liest aus v_public_sellable_courses (bestehender SSOT) + joint Kontext.
-- Keine neue Tabelle, kein neuer State.

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
  ORDER BY cat.chamber_type, cat.catalog_type, v.course_title;
$$;

GRANT EXECUTE ON FUNCTION public.public_sellable_course_catalog() TO anon, authenticated;

-- Smoke (informational)
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM public.public_sellable_course_catalog();
  RAISE NOTICE 'P74a catalog rows: %', n;
END $$;
