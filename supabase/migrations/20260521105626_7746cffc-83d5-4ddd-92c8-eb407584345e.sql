-- P6 Cut 3b — Dynamic Sitemap Entity Integration
-- Pattern-Policies für dynamische SEO-Routenklassen + Helper-RPC für Policy-Lookup.

-- 1. Pattern-Policies (prefix=index) für dynamische SEO-Zielrouten
INSERT INTO public.route_crawl_policy (pattern, match_type, state, source, priority, changefreq, reason) VALUES
  ('/paket/',            'prefix', 'index', 'p6c3b_seed', 0.85, 'weekly', 'Komplettpaket-Detailseiten (published course_packages)'),
  ('/blog/',             'prefix', 'index', 'p6c3b_seed', 0.70, 'weekly', 'Blog-Artikel (published blog_articles)'),
  ('/wissen/',           'prefix', 'index', 'p6c3b_seed', 0.60, 'weekly', 'Wissensseiten + SEO-Dokumente'),
  ('/pruefungstraining/','prefix', 'index', 'p6c3b_seed', 0.80, 'weekly', 'Prüfungstraining-Landingpages'),
  ('/berufe/',           'prefix', 'index', 'p6c3b_seed', 0.80, 'weekly', 'Beruf-Detailseiten'),
  ('/kurse/',            'prefix', 'index', 'p6c3b_seed', 0.75, 'weekly', 'SEO Pillar+Intent Pages (curriculum × intent × competency)'),
  ('/ihk-pruefungen/',   'prefix', 'index', 'p6c3b_seed', 0.70, 'weekly', 'IHK-Prüfungsseiten je Beruf'),
  ('/produkt/',          'prefix', 'index', 'p6c3b_seed', 0.70, 'weekly', 'Produkt-Detailseiten (active products / curriculum_products)'),
  ('/quiz/',             'prefix', 'index', 'p6c3b_seed', 0.65, 'weekly', 'Eligibility-Quiz Lead-Magnet (published quizzes)')
ON CONFLICT (pattern, match_type) DO UPDATE
  SET state      = EXCLUDED.state,
      source     = EXCLUDED.source,
      priority   = EXCLUDED.priority,
      changefreq = EXCLUDED.changefreq,
      reason     = EXCLUDED.reason;

-- /quiz/ war bisher prefix=noindex (Auth-Bereich). Konflikt: prefix-Pattern /quiz/ existiert
-- jetzt 2× (index + noindex). Lösung: noindex-prefix /quiz/ entfernen, weil die einzigen
-- öffentlich-quiz-Routen (/quiz/<slug>-pruefungsreife) sowieso bereits exact=index existieren.
-- Authenticated /quiz/*-Routen sind via /app/* abgedeckt.
-- HISTORICAL NOTE: kept prefix noindex /quiz/ row deleted in favor of allow-list (exact rows).
DELETE FROM public.route_crawl_policy
 WHERE pattern = '/quiz/' AND match_type = 'prefix' AND state = 'noindex';

-- 2. Helper-RPC: prüft ob ein Pfad indexierbar ist (Pattern-Match priorisiert exact > prefix > regex)
CREATE OR REPLACE FUNCTION public.fn_resolve_route_crawl_state(_path text)
RETURNS public.route_crawl_state
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _state public.route_crawl_state;
BEGIN
  -- 1. exact match
  SELECT state INTO _state
    FROM public.route_crawl_policy
   WHERE match_type = 'exact' AND pattern = _path
   LIMIT 1;
  IF _state IS NOT NULL THEN RETURN _state; END IF;

  -- 2. prefix match (längster zuerst → most-specific gewinnt)
  SELECT state INTO _state
    FROM public.route_crawl_policy
   WHERE match_type = 'prefix' AND _path LIKE pattern || '%'
   ORDER BY length(pattern) DESC
   LIMIT 1;
  IF _state IS NOT NULL THEN RETURN _state; END IF;

  -- 3. regex match
  SELECT state INTO _state
    FROM public.route_crawl_policy
   WHERE match_type = 'regex' AND _path ~ pattern
   LIMIT 1;
  IF _state IS NOT NULL THEN RETURN _state; END IF;

  -- Default: index (jede Route ohne explizite Policy ist standardmäßig indexierbar)
  RETURN 'index'::public.route_crawl_state;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_resolve_route_crawl_state(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_resolve_route_crawl_state(text) TO service_role, authenticated;

-- 3. View: berufe-slugs mit mindestens 1 published course_package (SSOT für /paket/:slug)
CREATE OR REPLACE VIEW public.v_paket_sitemap_entries AS
SELECT DISTINCT
  b.bezeichnung_kurz,
  MAX(GREATEST(cp.updated_at, cp.published_at)) AS lastmod
FROM public.course_packages cp
JOIN public.curricula c ON c.id = cp.curriculum_id
JOIN public.berufe    b ON b.id = c.beruf_id
WHERE cp.is_published = true
  AND b.ist_aktiv = true
  AND b.bezeichnung_kurz IS NOT NULL
GROUP BY b.bezeichnung_kurz;

REVOKE ALL ON public.v_paket_sitemap_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_paket_sitemap_entries TO service_role;

COMMENT ON VIEW public.v_paket_sitemap_entries IS
  'P6 Cut 3b SSOT: Beruf-Slugs mit mindestens 1 published course_package. Drives /paket/:slug Sitemap-Emission. Contract: COUNT(*) = COUNT(DISTINCT beruf) der published packages.';

COMMENT ON FUNCTION public.fn_resolve_route_crawl_state(text) IS
  'P6 Cut 3b: Resolve crawl-state für arbitrary path via route_crawl_policy (exact > prefix > regex). Default=index für unbekannte Pfade.';