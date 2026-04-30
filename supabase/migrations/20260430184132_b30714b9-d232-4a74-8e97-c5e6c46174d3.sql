-- ============================================================
-- SEO Auto-Match Suggestions: Trigram-basierte Vorschläge für
-- unmatched certification_seo_pages → existierende Pakete.
-- Liefert Top-N Kandidaten mit Score, damit Operator nicht raten muss.
-- ============================================================

-- Sicherstellen, dass pg_trgm verfügbar ist (für similarity()).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------
-- RPC: admin_seo_suggest_product_matches
-- Nimmt eine seo_id (certification_seo_pages) und liefert die
-- Top-N besten Match-Kandidaten gegen course_packages.
-- Match-Logik:
--   1. Slug-Tokenisierung (entferne -pruefung Suffix, splitte an '-')
--   2. Vergleich gegen package canonical_slug + course title
--   3. Trigram-Similarity (pg_trgm) als primärer Score
--   4. Bevorzuge published Pakete leicht (Bonus +0.05)
--   5. Nur Pakete mit nicht-trivialer Ähnlichkeit (>= 0.20)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_seo_suggest_product_matches(
  p_seo_id uuid,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  package_id uuid,
  package_title text,
  package_status text,
  canonical_slug text,
  match_score numeric,
  match_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_title text;
  v_needle text;
BEGIN
  -- Admin-Gate
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT csp.slug, csp.title
    INTO v_slug, v_title
  FROM public.certification_seo_pages csp
  WHERE csp.id = p_seo_id;

  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'seo_page_not_found';
  END IF;

  -- Normalisiere: entferne -pruefung Suffix, ersetze - mit Leerzeichen
  v_needle := lower(regexp_replace(v_slug, '-pruefung$', ''));
  v_needle := replace(v_needle, '-', ' ');

  RETURN QUERY
  WITH pkg_search AS (
    SELECT
      cp.id,
      cp.title AS pkg_title,
      cp.status::text AS pkg_status,
      COALESCE(c.title, cp.title) AS search_text,
      -- canonical_slug aus package title rekonstruieren (best-effort)
      lower(regexp_replace(COALESCE(c.title, cp.title), '[^a-z0-9]+', '-', 'g')) AS slug_guess
    FROM public.course_packages cp
    LEFT JOIN public.courses c ON c.id = cp.course_id
    WHERE cp.status IN ('published', 'draft', 'building')
  ),
  scored AS (
    SELECT
      ps.id,
      ps.pkg_title,
      ps.pkg_status,
      ps.slug_guess,
      GREATEST(
        similarity(lower(ps.search_text), v_needle),
        similarity(ps.slug_guess, replace(v_needle, ' ', '-'))
      ) AS sim_score,
      CASE WHEN ps.pkg_status = 'published' THEN 0.05 ELSE 0.0 END AS publish_bonus
    FROM pkg_search ps
  )
  SELECT
    s.id,
    s.pkg_title,
    s.pkg_status,
    s.slug_guess,
    ROUND((s.sim_score + s.publish_bonus)::numeric, 3) AS match_score,
    CASE
      WHEN s.sim_score >= 0.6 THEN 'strong_match'
      WHEN s.sim_score >= 0.4 THEN 'likely_match'
      WHEN s.sim_score >= 0.2 THEN 'weak_match'
      ELSE 'no_match'
    END AS match_reason
  FROM scored s
  WHERE s.sim_score >= 0.20
  ORDER BY (s.sim_score + s.publish_bonus) DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_seo_suggest_product_matches(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.admin_seo_suggest_product_matches IS
'Schlägt Top-N Paket-Matches für unmatched certification_seo_pages vor. Trigram-basiert. Admin-only.';