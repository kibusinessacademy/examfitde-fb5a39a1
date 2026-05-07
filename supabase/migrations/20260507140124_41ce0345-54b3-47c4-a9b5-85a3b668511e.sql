CREATE OR REPLACE FUNCTION public.admin_preview_content_graph_edge_plan(
  p_limit_per_node int DEFAULT 3,
  p_max_nodes int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied: admin role required';
  END IF;

  IF p_limit_per_node < 1 OR p_limit_per_node > 10 THEN
    RAISE EXCEPTION 'p_limit_per_node out of range (1..10)';
  END IF;
  IF p_max_nodes < 1 OR p_max_nodes > 500 THEN
    RAISE EXCEPTION 'p_max_nodes out of range (1..500)';
  END IF;

  WITH active_nodes AS (
    SELECT n.id, n.node_slug, n.title, n.asset_type, n.keyword_slug, n.cluster_id, n.persona
    FROM growth_content_graph_nodes n
    WHERE n.is_active = true
  ),
  existing_outbound AS (
    SELECT from_node_id, edge_type FROM growth_content_graph_edges
  ),
  missing_money AS (
    SELECT n.* FROM active_nodes n
    WHERE n.asset_type <> 'product'
      AND NOT EXISTS (SELECT 1 FROM existing_outbound e WHERE e.from_node_id = n.id AND e.edge_type = 'money_page')
  ),
  missing_funnel AS (
    SELECT n.* FROM active_nodes n
    WHERE NOT EXISTS (SELECT 1 FROM existing_outbound e WHERE e.from_node_id = n.id AND e.edge_type = 'funnel_next')
  ),
  money_proposals AS (
    SELECT
      m.id AS from_node_id, m.node_slug AS from_slug, m.title AS from_title, m.asset_type::text AS from_asset,
      p.id AS to_node_id, p.node_slug AS to_slug, p.title AS to_title,
      'money_page'::text AS edge_type,
      CASE
        WHEN m.keyword_slug IS NOT NULL AND p.keyword_slug = m.keyword_slug
             AND (SELECT count(*) FROM active_nodes p2 WHERE p2.asset_type='product' AND p2.keyword_slug = m.keyword_slug) = 1
          THEN 'high'
        WHEN m.keyword_slug IS NOT NULL AND p.keyword_slug = m.keyword_slug THEN 'medium'
        WHEN m.cluster_id IS NOT NULL AND p.cluster_id = m.cluster_id THEN 'medium'
        WHEN m.persona IS NOT NULL AND p.persona = m.persona THEN 'low'
        ELSE 'low'
      END AS confidence,
      CASE
        WHEN p.keyword_slug = m.keyword_slug THEN 'keyword_slug match: '||m.keyword_slug
        WHEN p.cluster_id = m.cluster_id THEN 'cluster match'
        WHEN p.persona = m.persona THEN 'persona fallback'
        ELSE 'fallback'
      END AS reason,
      row_number() OVER (
        PARTITION BY m.id
        ORDER BY
          CASE WHEN p.keyword_slug = m.keyword_slug THEN 0 WHEN p.cluster_id = m.cluster_id THEN 1 ELSE 2 END,
          p.node_slug
      ) AS rn
    FROM missing_money m
    JOIN active_nodes p ON p.asset_type = 'product' AND p.id <> m.id
      AND (p.keyword_slug = m.keyword_slug OR p.cluster_id = m.cluster_id OR p.persona = m.persona)
  ),
  money_top AS (SELECT * FROM money_proposals WHERE rn <= p_limit_per_node),
  funnel_proposals AS (
    SELECT
      f.id AS from_node_id, f.node_slug AS from_slug, f.title AS from_title, f.asset_type::text AS from_asset,
      tgt.id AS to_node_id, tgt.node_slug AS to_slug, tgt.title AS to_title,
      'funnel_next'::text AS edge_type,
      CASE
        WHEN f.keyword_slug IS NOT NULL AND tgt.keyword_slug = f.keyword_slug THEN 'medium'
        WHEN f.cluster_id IS NOT NULL AND tgt.cluster_id = f.cluster_id THEN 'medium'
        WHEN f.persona IS NOT NULL AND tgt.persona = f.persona THEN 'low'
        ELSE 'low'
      END AS confidence,
      CASE
        WHEN tgt.keyword_slug = f.keyword_slug THEN 'keyword_slug match'
        WHEN tgt.cluster_id = f.cluster_id THEN 'cluster match'
        ELSE 'persona fallback'
      END AS reason,
      row_number() OVER (
        PARTITION BY f.id
        ORDER BY
          CASE tgt.asset_type::text WHEN 'product' THEN 0 WHEN 'landing' THEN 1 WHEN 'hub' THEN 2 ELSE 3 END,
          CASE WHEN tgt.keyword_slug = f.keyword_slug THEN 0 ELSE 1 END,
          tgt.node_slug
      ) AS rn
    FROM missing_funnel f
    JOIN active_nodes tgt ON tgt.asset_type::text IN ('landing','product','hub') AND tgt.id <> f.id
      AND (tgt.keyword_slug = f.keyword_slug OR tgt.cluster_id = f.cluster_id OR tgt.persona = f.persona)
  ),
  funnel_top AS (SELECT * FROM funnel_proposals WHERE rn <= p_limit_per_node),
  combined AS (
    SELECT * FROM money_top
    UNION ALL
    SELECT * FROM funnel_top
  ),
  per_node AS (
    SELECT
      from_node_id, from_slug, from_title, from_asset,
      jsonb_agg(jsonb_build_object(
        'to_node_id',   to_node_id,
        'to_node_slug', to_slug,
        'to_title',     to_title,
        'edge_type',    edge_type,
        'confidence',   confidence,
        'reason',       reason
      ) ORDER BY edge_type, confidence DESC, to_slug) AS proposals,
      count(*) FILTER (WHERE confidence = 'high')   AS high_count,
      count(*) FILTER (WHERE confidence = 'medium') AS medium_count,
      count(*) FILTER (WHERE confidence = 'low')    AS low_count
    FROM combined
    GROUP BY from_node_id, from_slug, from_title, from_asset
    ORDER BY high_count DESC, medium_count DESC, from_slug
    LIMIT p_max_nodes
  ),
  totals AS (
    SELECT
      (SELECT count(*) FROM missing_money)  AS nodes_missing_money,
      (SELECT count(*) FROM missing_funnel) AS nodes_missing_funnel,
      (SELECT count(*) FROM combined WHERE confidence='high')   AS proposals_high,
      (SELECT count(*) FROM combined WHERE confidence='medium') AS proposals_medium,
      (SELECT count(*) FROM combined WHERE confidence='low')    AS proposals_low,
      (SELECT count(*) FROM combined) AS proposals_total
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'params', jsonb_build_object('limit_per_node', p_limit_per_node, 'max_nodes', p_max_nodes),
    'totals', (SELECT to_jsonb(t) FROM totals t),
    'nodes', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM per_node p), '[]'::jsonb),
    'note', 'read-only edge plan; apply via admin_apply_content_graph_edges'
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_preview_content_graph_edge_plan(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_content_graph_edge_plan(int, int) TO authenticated, service_role;