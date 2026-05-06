-- 1) SSOT-View neu mit cta_visible-basierter Quiz-Start-Rate
DROP VIEW IF EXISTS public.v_conversion_cta_performance CASCADE;

CREATE VIEW public.v_conversion_cta_performance AS
WITH cta_events AS (
  SELECT
    COALESCE(NULLIF(metadata->>'page_path',''), page_path) AS page_path,
    COALESCE(NULLIF(metadata->>'source',''), 'generic')    AS source,
    COALESCE(NULLIF(metadata->>'cta_location',''), 'unknown') AS cta_location,
    COALESCE(NULLIF(metadata->>'variant',''), 'A')         AS variant,
    NULLIF(metadata->>'quiz_slug','')                       AS quiz_slug,
    session_id,
    event_type,
    created_at
  FROM public.conversion_events
  WHERE created_at > now() - interval '7 days'
    AND event_type IN ('cta_visible','cta_clicked','lead_magnet_view','quiz_cta_clicked')
),
agg AS (
  SELECT
    page_path, source, cta_location, variant,
    COUNT(*) FILTER (WHERE event_type = 'cta_visible')      AS views,
    COUNT(*) FILTER (WHERE event_type IN ('cta_clicked','quiz_cta_clicked')) AS clicks,
    array_agg(DISTINCT session_id) FILTER (WHERE event_type = 'cta_visible' AND session_id IS NOT NULL) AS visible_sessions,
    array_agg(DISTINCT session_id) FILTER (WHERE event_type IN ('cta_clicked','quiz_cta_clicked') AND session_id IS NOT NULL) AS click_sessions,
    MIN(created_at) AS first_seen_at
  FROM cta_events
  GROUP BY 1,2,3,4
),
quiz_starts AS (
  SELECT session_id, COUNT(*) AS n
  FROM public.conversion_events
  WHERE created_at > now() - interval '7 days'
    AND event_type = 'quiz_started'
    AND session_id IS NOT NULL
  GROUP BY session_id
),
checkout_starts AS (
  SELECT session_id, COUNT(*) AS n
  FROM public.conversion_events
  WHERE created_at > now() - interval '7 days'
    AND event_type IN ('checkout_start','checkout_started')
    AND session_id IS NOT NULL
  GROUP BY session_id
)
SELECT
  a.page_path,
  a.source,
  a.cta_location,
  a.variant,
  a.views,
  a.clicks,
  a.first_seen_at,
  CASE WHEN a.views > 0 THEN ROUND((a.clicks::numeric / a.views) * 100, 2) ELSE 0 END AS ctr_pct,
  COALESCE((SELECT SUM(qs.n)::int FROM quiz_starts qs WHERE qs.session_id = ANY(a.click_sessions)), 0) AS quiz_started,
  CASE WHEN a.clicks > 0
       THEN ROUND((COALESCE((SELECT SUM(qs.n) FROM quiz_starts qs WHERE qs.session_id = ANY(a.click_sessions)),0)::numeric / a.clicks) * 100, 2)
       ELSE 0 END AS quiz_start_rate_pct,
  -- NEU: Quiz-Starts pro Visible (echte Funnel-Conversion ab Sichtkontakt)
  CASE WHEN a.views > 0
       THEN ROUND((COALESCE((SELECT SUM(qs.n) FROM quiz_starts qs WHERE qs.session_id = ANY(a.visible_sessions)),0)::numeric / a.views) * 100, 2)
       ELSE 0 END AS quiz_start_per_visible_pct,
  COALESCE((SELECT SUM(cs.n)::int FROM checkout_starts cs WHERE cs.session_id = ANY(a.click_sessions)), 0) AS checkout_started,
  CASE WHEN a.clicks > 0
       THEN ROUND((COALESCE((SELECT SUM(cs.n) FROM checkout_starts cs WHERE cs.session_id = ANY(a.click_sessions)),0)::numeric / a.clicks) * 100, 2)
       ELSE 0 END AS checkout_rate_pct
FROM agg a
ORDER BY a.cta_location, a.variant;

REVOKE ALL ON public.v_conversion_cta_performance FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_conversion_cta_performance TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_cta_performance()
RETURNS SETOF public.v_conversion_cta_performance
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.v_conversion_cta_performance
  WHERE public.has_role(auth.uid(), 'admin'::app_role);
$$;
REVOKE ALL ON FUNCTION public.admin_get_cta_performance() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_get_cta_performance() TO authenticated;

-- 2) Winner-Tabelle (per page_path × cta_location)
CREATE TABLE IF NOT EXISTS public.cta_winner_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_path text NOT NULL,
  cta_location text NOT NULL,
  winner_variant text NOT NULL CHECK (winner_variant IN ('A','B')),
  winner_quiz_start_per_visible_pct numeric NOT NULL,
  loser_quiz_start_per_visible_pct numeric NOT NULL,
  views_winner int NOT NULL,
  views_loser  int NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  decided_by text NOT NULL DEFAULT 'auto_48h_rule',
  data_window_start timestamptz NOT NULL,
  notes text,
  UNIQUE (page_path, cta_location)
);

ALTER TABLE public.cta_winner_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read winners"
  ON public.cta_winner_decisions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3) Auto-Promote-RPC (48h-Regel, min 30 Klicks/Variante, signifikanter Abstand)
CREATE OR REPLACE FUNCTION public.admin_auto_promote_cta_winners(
  p_min_hours int DEFAULT 48,
  p_min_clicks_per_variant int DEFAULT 30,
  p_min_delta_pct numeric DEFAULT 1.0
)
RETURNS TABLE(page_path text, cta_location text, winner text, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  cur_winner text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND NOT (current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  FOR r IN
    WITH base AS (
      SELECT v.page_path, v.cta_location, v.variant,
             v.views, v.clicks, v.first_seen_at,
             v.quiz_start_per_visible_pct
      FROM public.v_conversion_cta_performance v
      WHERE v.first_seen_at <= now() - make_interval(hours => p_min_hours)
    ),
    pivoted AS (
      SELECT page_path, cta_location,
        MAX(CASE WHEN variant='A' THEN views END) AS views_a,
        MAX(CASE WHEN variant='B' THEN views END) AS views_b,
        MAX(CASE WHEN variant='A' THEN clicks END) AS clicks_a,
        MAX(CASE WHEN variant='B' THEN clicks END) AS clicks_b,
        MAX(CASE WHEN variant='A' THEN quiz_start_per_visible_pct END) AS rate_a,
        MAX(CASE WHEN variant='B' THEN quiz_start_per_visible_pct END) AS rate_b,
        MIN(first_seen_at) AS window_start
      FROM base
      GROUP BY page_path, cta_location
    )
    SELECT * FROM pivoted
    WHERE clicks_a >= p_min_clicks_per_variant
      AND clicks_b >= p_min_clicks_per_variant
      AND ABS(COALESCE(rate_a,0) - COALESCE(rate_b,0)) >= p_min_delta_pct
  LOOP
    cur_winner := CASE WHEN COALESCE(r.rate_a,0) > COALESCE(r.rate_b,0) THEN 'A' ELSE 'B' END;

    INSERT INTO public.cta_winner_decisions (
      page_path, cta_location, winner_variant,
      winner_quiz_start_per_visible_pct, loser_quiz_start_per_visible_pct,
      views_winner, views_loser, data_window_start, decided_by
    )
    VALUES (
      r.page_path, r.cta_location, cur_winner,
      GREATEST(COALESCE(r.rate_a,0), COALESCE(r.rate_b,0)),
      LEAST(COALESCE(r.rate_a,0), COALESCE(r.rate_b,0)),
      CASE WHEN cur_winner='A' THEN r.views_a ELSE r.views_b END,
      CASE WHEN cur_winner='A' THEN r.views_b ELSE r.views_a END,
      r.window_start, 'auto_48h_rule'
    )
    ON CONFLICT (page_path, cta_location) DO UPDATE
      SET winner_variant = EXCLUDED.winner_variant,
          winner_quiz_start_per_visible_pct = EXCLUDED.winner_quiz_start_per_visible_pct,
          loser_quiz_start_per_visible_pct = EXCLUDED.loser_quiz_start_per_visible_pct,
          views_winner = EXCLUDED.views_winner,
          views_loser  = EXCLUDED.views_loser,
          decided_at   = now(),
          data_window_start = EXCLUDED.data_window_start;

    page_path := r.page_path;
    cta_location := r.cta_location;
    winner := cur_winner;
    action := 'promoted';
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_auto_promote_cta_winners(int,int,numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_auto_promote_cta_winners(int,int,numeric) TO authenticated, service_role;

-- 4) Reader-RPC für Frontend
CREATE OR REPLACE FUNCTION public.admin_get_cta_winners()
RETURNS SETOF public.cta_winner_decisions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.cta_winner_decisions
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  ORDER BY decided_at DESC;
$$;
REVOKE ALL ON FUNCTION public.admin_get_cta_winners() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_get_cta_winners() TO authenticated;

NOTIFY pgrst, 'reload schema';