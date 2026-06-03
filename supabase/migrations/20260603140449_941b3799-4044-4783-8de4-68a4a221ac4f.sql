INSERT INTO public.route_crawl_policy (pattern, match_type, state, redirect_to, source, reason) VALUES
  ('/komplettpaket',   'exact', 'redirect', '/paket',              'app_routes_redirect', 'Legacy product slug → canonical /paket'),
  ('/komplettpakete',  'exact', 'redirect', '/paket',              'app_routes_redirect', 'Legacy plural → canonical /paket'),
  ('/beruf-agent-os',  'exact', 'redirect', '/app/beruf-agent-os', 'app_routes_redirect', 'Public dash → app surface'),
  ('/oral',            'exact', 'redirect', '/muendliche-pruefung','app_routes_redirect', 'Short alias → SEO canonical'),
  ('/muendlich',       'exact', 'redirect', '/muendliche-pruefung','app_routes_redirect', 'Short alias → SEO canonical'),
  ('/ai-tutor',        'exact', 'redirect', '/tutor',              'app_routes_redirect', 'Legacy AI-Tutor → /tutor entry surface')
ON CONFLICT (pattern, match_type) DO UPDATE
  SET state       = EXCLUDED.state,
      redirect_to = EXCLUDED.redirect_to,
      source      = EXCLUDED.source,
      reason      = EXCLUDED.reason,
      updated_at  = now();