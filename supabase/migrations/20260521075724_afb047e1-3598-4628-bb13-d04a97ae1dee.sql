-- ============================================================================
-- P6 Cut 3 — Crawl-State SSOT (retry)
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE public.route_crawl_state AS ENUM ('index','noindex','redirect','gone');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.route_crawl_policy (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern      TEXT NOT NULL,
  match_type   TEXT NOT NULL CHECK (match_type IN ('exact','prefix','regex')),
  state        public.route_crawl_state NOT NULL,
  redirect_to  TEXT,
  reason       TEXT,
  source       TEXT NOT NULL DEFAULT 'manual',
  priority     NUMERIC,
  changefreq   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT route_crawl_policy_pattern_match_uq UNIQUE (pattern, match_type),
  CONSTRAINT route_crawl_policy_redirect_check
    CHECK ((state = 'redirect' AND redirect_to IS NOT NULL) OR (state <> 'redirect'))
);

CREATE INDEX IF NOT EXISTS idx_route_crawl_policy_state ON public.route_crawl_policy(state);
CREATE INDEX IF NOT EXISTS idx_route_crawl_policy_source ON public.route_crawl_policy(source);

ALTER TABLE public.route_crawl_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.route_crawl_policy FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_crawl_policy TO service_role;

CREATE OR REPLACE FUNCTION public.tg_route_crawl_policy_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_route_crawl_policy_touch ON public.route_crawl_policy;
CREATE TRIGGER trg_route_crawl_policy_touch
  BEFORE UPDATE ON public.route_crawl_policy
  FOR EACH ROW EXECUTE FUNCTION public.tg_route_crawl_policy_touch();

CREATE OR REPLACE FUNCTION public.public_get_indexable_routes()
RETURNS TABLE(pattern TEXT, priority NUMERIC, changefreq TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pattern, priority, changefreq
  FROM public.route_crawl_policy
  WHERE state = 'index' AND match_type = 'exact'
  ORDER BY COALESCE(priority, 0) DESC, pattern ASC;
$$;
REVOKE ALL ON FUNCTION public.public_get_indexable_routes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_indexable_routes() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_route_crawl_policy()
RETURNS SETOF public.route_crawl_policy
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT *
  FROM public.route_crawl_policy
  WHERE public.has_role(auth.uid(), 'admin')
  ORDER BY state, source, pattern;
$$;
REVOKE ALL ON FUNCTION public.admin_get_route_crawl_policy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_route_crawl_policy() TO authenticated, service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES ('route_crawl_policy_seeded', ARRAY['source','count'], 'seo_crawl_governance')
ON CONFLICT (action_type) DO NOTHING;

INSERT INTO public.route_crawl_policy (pattern, match_type, state, source, reason) VALUES
  ('/auth',                       'prefix', 'noindex', 'route_noindex', 'auth flow'),
  ('/dashboard',                  'prefix', 'noindex', 'route_noindex', 'protected learner'),
  ('/account',                    'prefix', 'noindex', 'route_noindex', 'account area'),
  ('/app',                        'prefix', 'noindex', 'route_noindex', 'protected app'),
  ('/checkout',                   'prefix', 'noindex', 'route_noindex', 'checkout flow'),
  ('/purchase-success',           'prefix', 'noindex', 'route_noindex', 'post-purchase'),
  ('/payment-success',            'prefix', 'noindex', 'route_noindex', 'post-purchase legacy'),
  ('/success',                    'prefix', 'noindex', 'route_noindex', 'post-purchase'),
  ('/willkommen',                 'prefix', 'noindex', 'route_noindex', 'post-purchase activation'),
  ('/org',                        'prefix', 'noindex', 'route_noindex', 'org area'),
  ('/partner',                    'prefix', 'noindex', 'route_noindex', 'partner area'),
  ('/admin',                      'prefix', 'noindex', 'route_noindex', 'admin v2'),
  ('/admin-v2',                   'prefix', 'noindex', 'route_noindex', 'admin v2 legacy'),
  ('/exam-trainer',               'prefix', 'noindex', 'route_noindex', 'protected'),
  ('/oral-exam',                  'prefix', 'noindex', 'route_noindex', 'protected'),
  ('/exam-simulation',            'prefix', 'noindex', 'route_noindex', 'protected'),
  ('/exam-results',               'prefix', 'noindex', 'route_noindex', 'protected'),
  ('/lesson',                     'prefix', 'noindex', 'route_noindex', 'protected'),
  ('/spaced-repetition',          'prefix', 'noindex', 'route_noindex', 'protected'),
  ('/drill',                      'prefix', 'noindex', 'route_noindex', 'protected'),
  ('/shuttle',                    'prefix', 'noindex', 'route_noindex', 'protected'),
  ('/daily-challenge',            'prefix', 'noindex', 'route_noindex', 'protected'),
  ('/heatmap',                    'prefix', 'noindex', 'route_noindex', 'protected'),
  ('/work',                       'prefix', 'noindex', 'route_noindex', 'B2B WIP'),
  ('/courses',                    'prefix', 'noindex', 'route_noindex', 'legacy listing'),
  ('/course/',                    'prefix', 'noindex', 'route_noindex', 'legacy detail'),
  ('/products',                   'prefix', 'noindex', 'route_noindex', 'legacy listing'),
  ('/product/',                   'prefix', 'noindex', 'route_noindex', 'legacy detail'),
  ('/category',                   'prefix', 'noindex', 'route_noindex', 'legacy taxonomy'),
  ('/search',                     'prefix', 'noindex', 'route_noindex', 'site search'),
  ('/learning',                   'prefix', 'noindex', 'route_noindex', 'legacy learner'),
  ('/apprenticeship-course-detail','prefix','noindex', 'route_noindex', 'legacy'),
  ('/diag',                       'prefix', 'noindex', 'route_noindex', 'internal diag'),
  ('/tools/',                     'prefix', 'noindex', 'route_noindex', 'internal tools'),
  ('/installieren',               'prefix', 'noindex', 'route_noindex', 'PWA install'),
  ('/renew',                      'prefix', 'noindex', 'route_noindex', 'license renew'),
  ('/quiz/',                      'prefix', 'noindex', 'route_noindex', 'lead quiz body'),
  ('/lernplan/',                  'prefix', 'noindex', 'route_noindex', 'lernplan body'),
  ('/pruefungsreife-ergebnis/',   'prefix', 'noindex', 'route_noindex', 'quiz result'),
  ('/legal',                      'prefix', 'noindex', 'route_noindex', 'legacy legal'),
  ('/user/',                      'prefix', 'noindex', 'route_noindex', 'legacy user'),
  ('/newsletter/',                'prefix', 'noindex', 'route_noindex', 'NL flow')
ON CONFLICT (pattern, match_type) DO NOTHING;

INSERT INTO public.route_crawl_policy (pattern, match_type, state, redirect_to, source, reason) VALUES
  ('/about',                          'exact',  'redirect', '/unternehmen',  'app_routes_redirect', 'GSC 404 cleanup'),
  ('/kontakt',                        'exact',  'redirect', '/impressum',    'app_routes_redirect', 'GSC 404 cleanup'),
  ('/registrieren',                   'exact',  'redirect', '/auth',         'app_routes_redirect', 'GSC 404 cleanup'),
  ('/repair-courses',                 'exact',  'redirect', '/',             'app_routes_redirect', 'legacy admin'),
  ('/legal/refund',                   'exact',  'redirect', '/agb',          'app_routes_redirect', 'GSC 404 cleanup'),
  ('/legal/impressum',                'exact',  'redirect', '/impressum',    'app_routes_redirect', 'GSC 404 cleanup'),
  ('/legal/agb',                      'exact',  'redirect', '/agb',          'app_routes_redirect', 'GSC 404 cleanup'),
  ('/legal/datenschutz',              'exact',  'redirect', '/datenschutz',  'app_routes_redirect', 'GSC 404 cleanup'),
  ('/user/support',                   'exact',  'redirect', '/faq',          'app_routes_redirect', 'GSC 404 cleanup'),
  ('/user',                           'prefix', 'redirect', '/faq',          'app_routes_redirect', 'GSC 404 cleanup'),
  ('/shop/products',                  'exact',  'redirect', '/shop',         'app_routes_redirect', 'GSC 404 cleanup'),
  ('/products',                       'exact',  'redirect', '/paket',        'app_routes_redirect', 'GSC 404 cleanup'),
  ('/product',                        'prefix', 'redirect', '/paket',        'app_routes_redirect', 'GSC 404 cleanup'),
  ('/category',                       'prefix', 'redirect', '/wissen',       'app_routes_redirect', 'GSC 404 cleanup'),
  ('/ausbildungsberufe',              'exact',  'redirect', '/ausbildung',   'app_routes_redirect', 'GSC 404 cleanup'),
  ('/apprenticeship-course-detail',   'prefix', 'redirect', '/ausbildung',   'app_routes_redirect', 'GSC 404 cleanup'),
  ('/learning/path',                  'prefix', 'redirect', '/dashboard',    'app_routes_redirect', 'legacy learner'),
  ('/learning',                       'prefix', 'redirect', '/dashboard',    'app_routes_redirect', 'legacy learner'),
  ('/payment-success',                'exact',  'redirect', '/purchase-success','app_routes_redirect','legacy'),
  ('/sitemap',                        'exact',  'redirect', '/sitemap.xml',  'app_routes_redirect', 'convenience'),
  ('/checkout/success',               'exact',  'redirect', '/willkommen',   'app_routes_redirect', 'legacy checkout')
ON CONFLICT (pattern, match_type) DO NOTHING;

INSERT INTO public.route_crawl_policy (pattern, match_type, state, source, priority, changefreq) VALUES
  ('/',                                              'exact','index','sitemap_static',1.0, 'daily'),
  ('/themen',                                        'exact','index','sitemap_static',0.95,'weekly'),
  ('/berufe',                                        'exact','index','sitemap_static',0.9, 'weekly'),
  ('/ihk-pruefungen',                                'exact','index','sitemap_static',0.9, 'weekly'),
  ('/lernkurse',                                     'exact','index','sitemap_static',0.9, 'weekly'),
  ('/pruefungstrainer',                              'exact','index','sitemap_static',0.9, 'weekly'),
  ('/paket',                                         'exact','index','sitemap_static',0.9, 'weekly'),
  ('/shop',                                          'exact','index','sitemap_static',0.8, 'weekly'),
  ('/ihk-pruefungsvorbereitung',                     'exact','index','sitemap_static',0.9, 'weekly'),
  ('/ihk-pruefungsfragen',                           'exact','index','sitemap_static',0.85,'weekly'),
  ('/ihk-fachgespraech',                             'exact','index','sitemap_static',0.8, 'monthly'),
  ('/ihk-probepruefung',                             'exact','index','sitemap_static',0.8, 'monthly'),
  ('/muendliche-pruefung',                           'exact','index','sitemap_static',0.85,'weekly'),
  ('/probepruefung',                                 'exact','index','sitemap_static',0.75,'monthly'),
  ('/lernplan-pruefung',                             'exact','index','sitemap_static',0.75,'monthly'),
  ('/pruefungsfragen',                               'exact','index','sitemap_static',0.8, 'weekly'),
  ('/wissen',                                        'exact','index','sitemap_static',0.8, 'daily'),
  ('/blog',                                          'exact','index','sitemap_static',0.8, 'daily'),
  ('/preise',                                        'exact','index','sitemap_static',0.7, 'monthly'),
  ('/unternehmen',                                   'exact','index','sitemap_static',0.6, 'monthly'),
  ('/pruefungstraining',                             'exact','index','sitemap_static',0.9, 'weekly'),
  ('/pruefungstraining/ausbildung',                  'exact','index','sitemap_static',0.8, 'weekly'),
  ('/pruefungstraining/fachwirt',                    'exact','index','sitemap_static',0.8, 'weekly'),
  ('/pruefungstraining/meister',                     'exact','index','sitemap_static',0.8, 'weekly'),
  ('/pruefungstraining/betriebswirt',                'exact','index','sitemap_static',0.8, 'weekly'),
  ('/pruefungstraining/sachkunde',                   'exact','index','sitemap_static',0.8, 'weekly'),
  ('/pruefungstraining/aevo',                        'exact','index','sitemap_static',0.8, 'weekly'),
  ('/aevo-pruefungsvorbereitung',                    'exact','index','sitemap_static',0.85,'weekly'),
  ('/aevo-schriftliche-pruefung',                    'exact','index','sitemap_static',0.7, 'monthly'),
  ('/aevo-praktische-pruefung',                      'exact','index','sitemap_static',0.7, 'monthly'),
  ('/aevo-fachgespraech',                            'exact','index','sitemap_static',0.7, 'monthly'),
  ('/quiz/aevo-pruefungsreife',                      'exact','index','sitemap_static',0.7, 'monthly'),
  ('/quiz/bilanzbuchhalter-pruefungsreife',          'exact','index','sitemap_static',0.7, 'monthly'),
  ('/quiz/wirtschaftsfachwirt-pruefungsreife',       'exact','index','sitemap_static',0.7, 'monthly'),
  ('/quiz/fiae-pruefungsreife',                      'exact','index','sitemap_static',0.7, 'monthly'),
  ('/bilanzbuchhalter-pruefungsvorbereitung',        'exact','index','sitemap_static',0.85,'weekly'),
  ('/bilanzbuchhalter-buchhaltung',                  'exact','index','sitemap_static',0.7, 'monthly'),
  ('/bilanzbuchhalter-jahresabschluss',              'exact','index','sitemap_static',0.7, 'monthly'),
  ('/bilanzbuchhalter-steuern',                      'exact','index','sitemap_static',0.7, 'monthly'),
  ('/fachinformatiker-ae-pruefungsvorbereitung',     'exact','index','sitemap_static',0.85,'weekly'),
  ('/fiae-anwendungsentwicklung',                    'exact','index','sitemap_static',0.7, 'monthly'),
  ('/fiae-wiso',                                     'exact','index','sitemap_static',0.7, 'monthly'),
  ('/fiae-projektarbeit',                            'exact','index','sitemap_static',0.7, 'monthly')
ON CONFLICT (pattern, match_type) DO NOTHING;

SELECT public.fn_emit_audit(
  'route_crawl_policy_seeded',
  NULL, NULL, NULL,
  jsonb_build_object(
    'source', 'p6_cut3_initial',
    'count', (SELECT COUNT(*) FROM public.route_crawl_policy),
    'noindex', (SELECT COUNT(*) FROM public.route_crawl_policy WHERE state='noindex'),
    'redirect', (SELECT COUNT(*) FROM public.route_crawl_policy WHERE state='redirect'),
    'index', (SELECT COUNT(*) FROM public.route_crawl_policy WHERE state='index')
  ),
  'success'
);
