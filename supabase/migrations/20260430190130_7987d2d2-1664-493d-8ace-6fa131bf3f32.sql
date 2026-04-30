
-- Fix: pg_trgm lebt im Schema 'extensions', nicht 'public'.
-- search_path = public reicht daher nicht — wir qualifizieren similarity() explizit.

CREATE OR REPLACE FUNCTION public.admin_seo_suggest_product_matches(p_seo_id uuid, p_limit integer DEFAULT 5)
RETURNS TABLE(package_id uuid, package_title text, package_status text, canonical_slug text, match_score numeric, match_reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_slug text;
  v_title text;
  v_needle text;
BEGIN
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

  v_needle := lower(regexp_replace(v_slug, '-pruefung$', ''));
  v_needle := replace(v_needle, '-', ' ');

  RETURN QUERY
  WITH pkg_search AS (
    SELECT
      cp.id,
      cp.title AS pkg_title,
      cp.status::text AS pkg_status,
      COALESCE(c.title, cp.title) AS search_text,
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
        extensions.similarity(lower(ps.search_text), v_needle),
        extensions.similarity(ps.slug_guess, replace(v_needle, ' ', '-'))
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
$function$;
