INSERT INTO public.route_crawl_policy (pattern, match_type, state, redirect_to, source, reason)
VALUES ('/shop', 'exact', 'redirect', '/examfit', 'app_routes_redirect', 'examfit hardcut 2026')
ON CONFLICT (pattern, match_type) DO UPDATE
  SET state = EXCLUDED.state,
      redirect_to = EXCLUDED.redirect_to,
      source = EXCLUDED.source,
      reason = EXCLUDED.reason;