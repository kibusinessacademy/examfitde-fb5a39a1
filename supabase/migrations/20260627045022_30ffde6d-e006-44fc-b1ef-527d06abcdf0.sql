DELETE FROM public.route_crawl_policy WHERE pattern = '/shop' AND match_type = 'exact' AND state = 'index';
DELETE FROM public.route_crawl_policy WHERE pattern = '/shop/products' AND match_type = 'exact' AND state = 'redirect';
INSERT INTO public.route_crawl_policy (pattern, match_type, state, redirect_to, source, reason)
VALUES ('/shop/products', 'exact', 'redirect', '/examfit', 'app_routes_redirect', 'examfit hardcut 2026')
ON CONFLICT (pattern, match_type) DO UPDATE
  SET state = EXCLUDED.state,
      redirect_to = EXCLUDED.redirect_to,
      source = EXCLUDED.source,
      reason = EXCLUDED.reason;