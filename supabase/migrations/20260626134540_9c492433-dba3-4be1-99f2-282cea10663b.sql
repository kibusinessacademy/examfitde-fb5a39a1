
-- =====================================================================
-- 1) Cache-bust signal for /berufe catalog
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.catalog_cache_signal (
  id text PRIMARY KEY DEFAULT 'singleton',
  source text NOT NULL DEFAULT 'init',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.catalog_cache_signal TO anon, authenticated;
GRANT ALL ON public.catalog_cache_signal TO service_role;

ALTER TABLE public.catalog_cache_signal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalog_cache_signal_public_read" ON public.catalog_cache_signal;
CREATE POLICY "catalog_cache_signal_public_read"
  ON public.catalog_cache_signal FOR SELECT
  USING (true);

INSERT INTO public.catalog_cache_signal(id, source) VALUES ('singleton','init')
  ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bump_catalog_cache_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.catalog_cache_signal
     SET updated_at = now(), source = TG_TABLE_NAME
   WHERE id = 'singleton';
  RETURN NULL;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['products','product_prices','curricula','courses','course_packages']) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_catalog_cache_signal ON public.%I;', t);
    EXECUTE format(
      'CREATE TRIGGER trg_catalog_cache_signal AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.bump_catalog_cache_signal();',
      t
    );
  END LOOP;
END $$;

-- =====================================================================
-- 2) Catalog Diagnostics View
-- =====================================================================
CREATE OR REPLACE VIEW public.v_admin_catalog_diagnostics
WITH (security_invoker = on) AS
WITH base AS (
  SELECT
    b.id              AS beruf_id,
    b.bezeichnung_kurz AS title,
    b.zustaendigkeit,
    b.ausbildungsdauer_monate,
    b.dqr_niveau,
    NULLIF(b.taetigkeitsprofil,'') AS taetigkeitsprofil,
    v.curriculum_id,
    v.package_id
  FROM public.berufe b
  LEFT JOIN public.v_course_display_ssot v ON v.beruf_id = b.id
  WHERE b.ist_aktiv = true
),
checks AS (
  SELECT
    base.*,
    (base.curriculum_id IS NULL) AS missing_curriculum,
    EXISTS (SELECT 1 FROM public.courses c
             WHERE c.curriculum_id = base.curriculum_id
               AND c.status = 'published') AS has_published_course,
    EXISTS (SELECT 1 FROM public.products p
             WHERE p.curriculum_id = base.curriculum_id
               AND p.status = 'active'
               AND p.visibility = 'public') AS has_active_product,
    EXISTS (SELECT 1 FROM public.products p
             JOIN public.product_prices pr ON pr.product_id = p.id AND pr.active
             WHERE p.curriculum_id = base.curriculum_id
               AND pr.stripe_price_id IS NOT NULL) AS has_stripe_price,
    EXISTS (SELECT 1 FROM public.v_public_sellable_courses s
             WHERE s.curriculum_id = base.curriculum_id
               AND s.is_sellable) AS is_sellable
  FROM base
),
gaps AS (
  SELECT g.curriculum_id,
         max(g.classification) AS gap_classification,
         max(g.recommended_action) AS gap_recommended_action,
         sum(g.lesson_count)::int AS lesson_count,
         sum(g.lesson_ready_count)::int AS lesson_ready_count
  FROM public.course_packages cp
  JOIN public.v_lessons_gap_ssot g ON g.package_id = cp.id
  WHERE cp.status = 'published'
  GROUP BY g.curriculum_id
)
SELECT
  c.beruf_id,
  c.title,
  c.curriculum_id,
  c.package_id,
  c.is_sellable,
  c.missing_curriculum,
  c.has_published_course,
  c.has_active_product,
  c.has_stripe_price,
  g.gap_classification,
  g.gap_recommended_action,
  g.lesson_count,
  g.lesson_ready_count,
  (c.taetigkeitsprofil IS NOT NULL) AS teaser_is_real_usp,
  CASE
    WHEN c.is_sellable THEN 'sellable'
    WHEN c.missing_curriculum THEN 'no_curriculum'
    WHEN NOT c.has_published_course THEN 'course_not_published'
    WHEN NOT c.has_active_product THEN 'product_inactive_or_private'
    WHEN NOT c.has_stripe_price THEN 'missing_stripe_price'
    WHEN g.gap_classification IS NULL THEN 'lessons_gap_unknown'
    WHEN g.gap_classification NOT IN ('HAS_READY','EXEMPT') THEN 'lessons_not_ready'
    ELSE 'unknown'
  END AS block_reason,
  c.ausbildungsdauer_monate,
  c.dqr_niveau
FROM checks c
LEFT JOIN gaps g USING (curriculum_id);

GRANT SELECT ON public.v_admin_catalog_diagnostics TO authenticated, service_role;

-- =====================================================================
-- 3) STUDIUM gap audit
-- =====================================================================
CREATE OR REPLACE VIEW public.v_admin_studium_gap_findings
WITH (security_invoker = on) AS
SELECT
  s.product_id,
  s.product_title,
  s.product_slug,
  s.curriculum_id,
  cur.track::text AS track,
  s.is_sellable,
  EXISTS (
    SELECT 1 FROM public.v_full_course_catalog vfc
     WHERE vfc.published_slug = s.product_slug OR vfc.slug = s.product_slug
  ) AS visible_in_catalog,
  CASE
    WHEN cur.track::text <> 'STUDIUM' THEN 'not_studium'
    WHEN NOT s.is_sellable THEN 'studium_not_sellable_yet'
    WHEN NOT EXISTS (SELECT 1 FROM public.v_full_course_catalog vfc
                      WHERE vfc.published_slug = s.product_slug OR vfc.slug = s.product_slug)
      THEN 'studium_sellable_but_missing_in_catalog'
    ELSE 'ok'
  END AS finding
FROM public.v_public_sellable_courses s
JOIN public.curricula cur ON cur.id = s.curriculum_id
WHERE cur.track::text = 'STUDIUM' OR s.product_slug IS NOT NULL AND s.is_sellable;

GRANT SELECT ON public.v_admin_studium_gap_findings TO authenticated, service_role;

-- =====================================================================
-- 4) Teaser quality summary
-- =====================================================================
CREATE OR REPLACE VIEW public.v_admin_catalog_teaser_quality
WITH (security_invoker = on) AS
SELECT
  COALESCE(category,'unknown') AS category,
  COUNT(*) AS entries,
  COUNT(*) FILTER (WHERE description IS NOT NULL) AS with_real_usp,
  COUNT(*) FILTER (WHERE description IS NULL) AS with_fallback_only,
  ROUND(100.0 * COUNT(*) FILTER (WHERE description IS NOT NULL) / NULLIF(COUNT(*),0), 1) AS pct_real_usp
FROM public.v_full_course_catalog
GROUP BY 1
ORDER BY 1;

GRANT SELECT ON public.v_admin_catalog_teaser_quality TO authenticated, service_role;

-- =====================================================================
-- 5) Admin RPCs (admin-gated)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_catalog_diagnostics()
RETURNS SETOF public.v_admin_catalog_diagnostics
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.* FROM public.v_admin_catalog_diagnostics d
  WHERE public.has_role(auth.uid(), 'admin'::app_role);
$$;

REVOKE ALL ON FUNCTION public.admin_catalog_diagnostics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_catalog_diagnostics() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_studium_gap()
RETURNS SETOF public.v_admin_studium_gap_findings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.* FROM public.v_admin_studium_gap_findings d
  WHERE public.has_role(auth.uid(), 'admin'::app_role);
$$;

REVOKE ALL ON FUNCTION public.admin_studium_gap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_studium_gap() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_catalog_teaser_quality()
RETURNS SETOF public.v_admin_catalog_teaser_quality
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.* FROM public.v_admin_catalog_teaser_quality d
  WHERE public.has_role(auth.uid(), 'admin'::app_role);
$$;

REVOKE ALL ON FUNCTION public.admin_catalog_teaser_quality() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_catalog_teaser_quality() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
