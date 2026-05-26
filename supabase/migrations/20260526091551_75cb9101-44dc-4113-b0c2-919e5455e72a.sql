-- 1. Seed missing redirect rules for new BerufOS landing redirects
INSERT INTO public.route_crawl_policy (pattern, match_type, state, redirect_to, source, reason) VALUES
  ('/berufos',           'exact', 'redirect', '/',                  'app_routes_redirect', 'BerufOS brand landing → home (Hardcut 2026-05-25)'),
  ('/vibeos',            'exact', 'redirect', '/',                  'app_routes_redirect', 'VibeOS brand landing → home'),
  ('/platform',          'exact', 'redirect', '/',                  'app_routes_redirect', 'Legacy /platform → home'),
  ('/angebotsvergleich', 'exact', 'redirect', '/offer-comparison',  'app_routes_redirect', 'DE alias → canonical offer comparison'),
  ('/fördermittel',      'exact', 'redirect', '/foerdermittel',     'app_routes_redirect', 'Umlaut alias → canonical ASCII slug')
ON CONFLICT (pattern, match_type) DO UPDATE
  SET state       = EXCLUDED.state,
      redirect_to = EXCLUDED.redirect_to,
      source      = EXCLUDED.source,
      reason      = EXCLUDED.reason,
      updated_at  = now();

-- 2. Fix S1 burst contract: reaper churn > 5 must halve (not ×0.7)
CREATE OR REPLACE FUNCTION public.fn_adaptive_burst_size_v2(
  p_pending integer,
  p_failure_rate_15m numeric DEFAULT 0,
  p_reaper_churn_5m integer DEFAULT 0,
  p_lane text DEFAULT NULL::text,
  p_pool text DEFAULT 'default'::text
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_base int;
BEGIN
  v_base := CASE
    WHEN p_pending > 1000 THEN 75
    WHEN p_pending >  500 THEN 50
    WHEN p_pending >  100 THEN 35
    ELSE 25
  END;

  -- Shed under failure pressure
  IF COALESCE(p_failure_rate_15m,0) > 0.20 THEN
    v_base := GREATEST(5, floor(v_base * 0.5)::int);
  ELSIF COALESCE(p_failure_rate_15m,0) > 0.10 THEN
    v_base := GREATEST(10, floor(v_base * 0.75)::int);
  END IF;

  -- Shed under reaper churn (worker instability) — S1 contract: > 5 halves
  IF COALESCE(p_reaper_churn_5m,0) > 10 THEN
    v_base := GREATEST(5, floor(v_base * 0.5)::int);
  ELSIF COALESCE(p_reaper_churn_5m,0) > 5 THEN
    v_base := GREATEST(5, floor(v_base * 0.5)::int);
  END IF;

  -- Lane-specific caps/floors
  IF p_lane = 'control' THEN
    v_base := LEAST(v_base, 35);
  ELSIF p_lane = 'recovery' THEN
    v_base := GREATEST(v_base, 35);
  END IF;

  IF COALESCE(p_pool,'default') <> 'default' THEN
    v_base := LEAST(v_base, 25);
  END IF;

  RETURN GREATEST(5, LEAST(100, v_base));
END $function$;