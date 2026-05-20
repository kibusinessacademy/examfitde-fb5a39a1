-- ============================================================
-- P7 — Semantic Search Feedback Loop + Indexability Evidence
-- ============================================================

CREATE TABLE IF NOT EXISTS public.semantic_route_search_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_path text NOT NULL,
  route_kind text NOT NULL CHECK (route_kind IN ('beruf','kompetenz','pruefung')),
  route_key text NOT NULL,
  date date NOT NULL,
  impressions integer NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks integer NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  ctr numeric NOT NULL DEFAULT 0 CHECK (ctr >= 0),
  avg_position numeric NULL CHECK (avg_position IS NULL OR avg_position >= 0),
  query_count integer NOT NULL DEFAULT 0 CHECK (query_count >= 0),
  source text NOT NULL DEFAULT 'gsc' CHECK (source IN ('gsc','manual_gsc_export')),
  imported_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_semantic_metric_clicks_lte_impressions CHECK (clicks <= impressions),
  CONSTRAINT uq_semantic_route_metric_day_source UNIQUE (route_path, date, source)
);

CREATE INDEX IF NOT EXISTS idx_semantic_route_search_metrics_route_date
  ON public.semantic_route_search_metrics (route_path, date DESC);

CREATE INDEX IF NOT EXISTS idx_semantic_route_search_metrics_kind_key
  ON public.semantic_route_search_metrics (route_kind, route_key, date DESC);

ALTER TABLE public.semantic_route_search_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "semantic_search_metrics_service_role_all" ON public.semantic_route_search_metrics;
CREATE POLICY "semantic_search_metrics_service_role_all" ON public.semantic_route_search_metrics
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.fn_semantic_search_parse_wissen_route(_route_path text)
RETURNS TABLE(route_kind text, route_key text)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT m[1] AS route_kind, m[2] AS route_key
  FROM regexp_matches(COALESCE(_route_path, ''), '^/wissen/(beruf|kompetenz|pruefung)/([^/?#]+)$') AS m
$$;

CREATE OR REPLACE FUNCTION public.fn_semantic_search_route_exists(_route_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH parsed AS (
    SELECT * FROM public.fn_semantic_search_parse_wissen_route(_route_path)
  ), cur AS (
    SELECT id FROM public.semantic_graph_snapshots WHERE status = 'published' LIMIT 1
  )
  SELECT EXISTS (
    SELECT 1
    FROM parsed p
    JOIN cur ON true
    JOIN public.semantic_graph_entities e
      ON e.snapshot_id = cur.id
     AND e.kind = p.route_kind
     AND e.key = p.route_key
  )
$$;

CREATE OR REPLACE FUNCTION public.fn_semantic_search_safe_metadata(_metadata jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _key text;
  _value jsonb;
  _out jsonb := '{}'::jsonb;
BEGIN
  IF _metadata IS NULL OR jsonb_typeof(_metadata) <> 'object' THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR _key, _value IN SELECT key, value FROM jsonb_each(_metadata)
  LOOP
    IF lower(_key) IN ('query','queries','search_query','raw_query','raw_queries','gsc_query') THEN
      RAISE EXCEPTION 'raw_query_dump_detected:%', _key;
    END IF;
    IF _key ~* '(secret|token|api[_-]?key|authorization|credential|password)' THEN
      RAISE EXCEPTION 'secret_leak_risk:%', _key;
    END IF;
    IF jsonb_typeof(_value) IN ('string','number','boolean') THEN
      _out := _out || jsonb_build_object(_key, _value);
    END IF;
  END LOOP;

  RETURN _out;
END;
$$;

CREATE OR REPLACE VIEW public.v_semantic_route_search_health AS
WITH cur AS (
  SELECT id, snapshot_at
  FROM public.semantic_graph_snapshots
  WHERE status = 'published'
  LIMIT 1
), graph_routes AS (
  SELECT
    '/wissen/' || e.kind || '/' || e.key AS route_path,
    e.kind AS route_kind,
    e.key AS route_key,
    e.name AS entity_label,
    true AS is_in_published_graph,
    true AS is_in_sitemap,
    EXTRACT(EPOCH FROM (now() - cur.snapshot_at)) / 60 AS snapshot_age_minutes
  FROM cur
  JOIN public.semantic_graph_entities e ON e.snapshot_id = cur.id
  WHERE e.kind IN ('beruf','kompetenz','pruefung')
), metric_routes AS (
  SELECT DISTINCT
    m.route_path,
    m.route_kind,
    m.route_key,
    NULL::text AS entity_label,
    false AS is_in_published_graph,
    false AS is_in_sitemap,
    NULL::numeric AS snapshot_age_minutes
  FROM public.semantic_route_search_metrics m
), routes AS (
  SELECT * FROM graph_routes
  UNION ALL
  SELECT mr.*
  FROM metric_routes mr
  WHERE NOT EXISTS (SELECT 1 FROM graph_routes gr WHERE gr.route_path = mr.route_path)
), agg AS (
  SELECT
    route_path,
    min(date) AS first_seen,
    max(date) AS last_seen_in_gsc,
    COALESCE(sum(impressions) FILTER (WHERE date >= current_date - 6), 0)::int AS impressions_7d,
    COALESCE(sum(impressions) FILTER (WHERE date >= current_date - 27), 0)::int AS impressions_28d,
    COALESCE(sum(clicks) FILTER (WHERE date >= current_date - 6), 0)::int AS clicks_7d,
    COALESCE(sum(clicks) FILTER (WHERE date >= current_date - 27), 0)::int AS clicks_28d,
    CASE WHEN COALESCE(sum(impressions) FILTER (WHERE date >= current_date - 27), 0) > 0
      THEN COALESCE(sum(clicks) FILTER (WHERE date >= current_date - 27), 0)::numeric
        / NULLIF(COALESCE(sum(impressions) FILTER (WHERE date >= current_date - 27), 0), 0)
      ELSE 0 END AS ctr_28d,
    avg(avg_position) FILTER (WHERE date >= current_date - 27 AND avg_position IS NOT NULL) AS avg_position_28d,
    COALESCE(sum(query_count) FILTER (WHERE date >= current_date - 27), 0)::int AS query_count_28d
  FROM public.semantic_route_search_metrics
  GROUP BY route_path
)
SELECT
  r.route_path,
  r.route_kind,
  r.route_key,
  COALESCE(r.entity_label, r.route_key) AS entity_label,
  r.is_in_published_graph,
  r.is_in_sitemap,
  a.last_seen_in_gsc,
  COALESCE(a.impressions_7d, 0) AS impressions_7d,
  COALESCE(a.impressions_28d, 0) AS impressions_28d,
  COALESCE(a.clicks_7d, 0) AS clicks_7d,
  COALESCE(a.clicks_28d, 0) AS clicks_28d,
  COALESCE(a.ctr_28d, 0) AS ctr_28d,
  a.avg_position_28d,
  CASE WHEN a.first_seen IS NULL THEN NULL ELSE (current_date - a.first_seen)::int END AS days_since_first_seen,
  CASE
    WHEN NOT r.is_in_published_graph THEN 'not_in_graph'
    WHEN NOT r.is_in_sitemap THEN 'not_in_sitemap'
    WHEN COALESCE(a.impressions_28d, 0) = 0 AND a.first_seen IS NULL AND COALESCE(r.snapshot_age_minutes, 0) < 1440 THEN 'needs_observation'
    WHEN COALESCE(a.impressions_28d, 0) = 0 THEN 'no_search_signal'
    WHEN COALESCE(a.impressions_28d, 0) > 0 AND COALESCE(a.clicks_28d, 0) = 0 THEN 'impressions_no_clicks'
    WHEN COALESCE(a.clicks_28d, 0) > 0 THEN 'performing'
    ELSE 'needs_observation'
  END AS search_state,
  CASE
    WHEN NOT r.is_in_published_graph THEN 'check_graph_route'
    WHEN NOT r.is_in_sitemap THEN 'check_sitemap'
    WHEN COALESCE(a.impressions_28d, 0) = 0 THEN 'wait_for_indexing'
    WHEN COALESCE(a.impressions_28d, 0) > 0 AND COALESCE(a.clicks_28d, 0) = 0 THEN 'improve_snippet'
    WHEN COALESCE(a.clicks_28d, 0) > 0 THEN 'none'
    ELSE 'review_search_intent'
  END AS recommended_action
FROM routes r
LEFT JOIN agg a ON a.route_path = r.route_path;

REVOKE ALL ON public.v_semantic_route_search_health FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_semantic_search_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (
    SELECT CASE WHEN auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin') THEN true ELSE false END AS ok
  ), rows AS (
    SELECT * FROM public.v_semantic_route_search_health WHERE (SELECT ok FROM guard)
  ), summary AS (
    SELECT
      count(*)::int AS total_routes,
      count(*) FILTER (WHERE search_state = 'performing')::int AS performing_count,
      count(*) FILTER (WHERE search_state = 'no_search_signal')::int AS no_signal_count,
      count(*) FILTER (WHERE search_state = 'impressions_no_clicks')::int AS impressions_no_clicks_count,
      count(*) FILTER (WHERE search_state = 'not_in_sitemap')::int AS not_in_sitemap_count,
      count(*) FILTER (WHERE search_state = 'not_in_graph')::int AS not_in_graph_count,
      COALESCE(sum(impressions_28d), 0)::int AS total_impressions_28d,
      COALESCE(sum(clicks_28d), 0)::int AS total_clicks_28d,
      CASE WHEN COALESCE(sum(impressions_28d), 0) > 0 THEN COALESCE(sum(clicks_28d), 0)::numeric / NULLIF(sum(impressions_28d), 0) ELSE 0 END AS avg_ctr_28d
    FROM rows
  ), top_routes AS (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.clicks_28d DESC, t.impressions_28d DESC), '[]'::jsonb) AS data
    FROM (
      SELECT route_path, route_kind, route_key, entity_label, search_state, impressions_28d, clicks_28d, ctr_28d, avg_position_28d, recommended_action
      FROM rows
      WHERE clicks_28d > 0
      ORDER BY clicks_28d DESC, impressions_28d DESC
      LIMIT 10
    ) t
  ), attention_routes AS (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.impressions_28d DESC, t.route_path), '[]'::jsonb) AS data
    FROM (
      SELECT route_path, route_kind, route_key, entity_label, search_state, impressions_28d, clicks_28d, ctr_28d, avg_position_28d, recommended_action
      FROM rows
      WHERE search_state <> 'performing'
      ORDER BY impressions_28d DESC, route_path
      LIMIT 25
    ) t
  )
  SELECT CASE
    WHEN NOT (SELECT ok FROM guard) THEN jsonb_build_object('error', 'forbidden')
    ELSE jsonb_build_object(
      'summary', to_jsonb(summary),
      'top_routes', (SELECT data FROM top_routes),
      'attention_routes', (SELECT data FROM attention_routes)
    )
  END
  FROM summary;
$$;

CREATE OR REPLACE FUNCTION public.admin_semantic_route_search_detail(_route_path text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (
    SELECT CASE WHEN auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin') THEN true ELSE false END AS ok
  ), parsed AS (
    SELECT * FROM public.fn_semantic_search_parse_wissen_route(_route_path)
  ), health AS (
    SELECT * FROM public.v_semantic_route_search_health
    WHERE route_path = _route_path AND (SELECT ok FROM guard)
    LIMIT 1
  ), daily AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'date', date,
      'impressions', impressions,
      'clicks', clicks,
      'ctr', ctr,
      'avg_position', avg_position,
      'query_count', query_count,
      'source', source
    ) ORDER BY date), '[]'::jsonb) AS data
    FROM public.semantic_route_search_metrics
    WHERE route_path = _route_path AND date >= current_date - 90 AND (SELECT ok FROM guard)
  )
  SELECT CASE
    WHEN NOT (SELECT ok FROM guard) THEN jsonb_build_object('error', 'forbidden')
    WHEN NOT EXISTS (SELECT 1 FROM parsed) THEN jsonb_build_object('error', 'invalid_route_path')
    ELSE jsonb_build_object('route', COALESCE((SELECT to_jsonb(health) FROM health), '{}'::jsonb), 'daily', (SELECT data FROM daily))
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_import_semantic_search_metrics(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row jsonb;
  _source text := COALESCE(NULLIF(_payload->>'source', ''), 'gsc');
  _route text;
  _kind text;
  _key text;
  _date date;
  _impressions int;
  _clicks int;
  _ctr numeric;
  _avg numeric;
  _query_count int;
  _metadata jsonb;
  _imported int := 0;
  _rejected int := 0;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin')) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF _source NOT IN ('gsc','manual_gsc_export') THEN
    RETURN jsonb_build_object('error', 'invalid_source');
  END IF;

  IF jsonb_typeof(_payload->'rows') <> 'array' THEN
    RETURN jsonb_build_object('error', 'invalid_rows');
  END IF;

  FOR _row IN SELECT * FROM jsonb_array_elements(_payload->'rows')
  LOOP
    _route := _row->>'route_path';
    SELECT route_kind, route_key INTO _kind, _key FROM public.fn_semantic_search_parse_wissen_route(_route) LIMIT 1;

    IF _kind IS NULL OR NOT public.fn_semantic_search_route_exists(_route) THEN
      _rejected := _rejected + 1;
      CONTINUE;
    END IF;

    _date := NULLIF(_row->>'date', '')::date;
    _impressions := COALESCE((_row->>'impressions')::int, 0);
    _clicks := COALESCE((_row->>'clicks')::int, 0);
    _avg := NULLIF(_row->>'avg_position', '')::numeric;
    _query_count := COALESCE((_row->>'query_count')::int, 0);
    _metadata := public.fn_semantic_search_safe_metadata(COALESCE(_row->'metadata', '{}'::jsonb));

    IF _date IS NULL OR _impressions < 0 OR _clicks < 0 OR _clicks > _impressions OR _query_count < 0 OR (_avg IS NOT NULL AND _avg < 0) THEN
      _rejected := _rejected + 1;
      CONTINUE;
    END IF;

    _ctr := CASE WHEN _impressions > 0 THEN _clicks::numeric / _impressions ELSE 0 END;

    INSERT INTO public.semantic_route_search_metrics(route_path, route_kind, route_key, date, impressions, clicks, ctr, avg_position, query_count, source, metadata)
    VALUES (_route, _kind, _key, _date, _impressions, _clicks, _ctr, _avg, _query_count, _source, _metadata)
    ON CONFLICT (route_path, date, source)
    DO UPDATE SET
      impressions = EXCLUDED.impressions,
      clicks = EXCLUDED.clicks,
      ctr = EXCLUDED.ctr,
      avg_position = EXCLUDED.avg_position,
      query_count = EXCLUDED.query_count,
      imported_at = now(),
      metadata = EXCLUDED.metadata;

    _imported := _imported + 1;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, result_status, metadata)
  VALUES ('semantic_search_metrics_imported', 'success', jsonb_build_object('source', _source, 'imported', _imported, 'rejected', _rejected));

  RETURN jsonb_build_object('imported', _imported, 'rejected', _rejected, 'source', _source);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_semantic_search_health() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_semantic_route_search_detail(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_import_semantic_search_metrics(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_semantic_search_health() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_semantic_route_search_detail(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_import_semantic_search_metrics(jsonb) TO authenticated, service_role;
