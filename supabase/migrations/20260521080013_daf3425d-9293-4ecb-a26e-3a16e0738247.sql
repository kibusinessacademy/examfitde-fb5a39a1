-- Add 2 missing redirects
INSERT INTO public.route_crawl_policy (pattern, match_type, state, redirect_to, source, reason) VALUES
  ('/org',                                 'exact', 'redirect', '/org/enterprise',                    'app_routes_redirect', 'org default'),
  ('/pruefungstraining-institutionen',     'exact', 'redirect', '/pruefungstraining-berufsschulen',   'app_routes_redirect', 'rename')
ON CONFLICT (pattern, match_type) DO NOTHING;

-- Remove 3 redundant noindex prefixes (redirect supersedes)
DELETE FROM public.route_crawl_policy
WHERE state = 'noindex'
  AND match_type = 'prefix'
  AND pattern IN ('/category', '/learning', '/apprenticeship-course-detail');

SELECT public.fn_emit_audit(
  'route_crawl_policy_seeded',
  NULL, NULL, NULL,
  jsonb_build_object(
    'source', 'p6_cut3_fixup',
    'count', (SELECT COUNT(*) FROM public.route_crawl_policy),
    'noindex', (SELECT COUNT(*) FROM public.route_crawl_policy WHERE state='noindex'),
    'redirect', (SELECT COUNT(*) FROM public.route_crawl_policy WHERE state='redirect'),
    'index', (SELECT COUNT(*) FROM public.route_crawl_policy WHERE state='index')
  ),
  'success'
);
