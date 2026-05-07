CREATE OR REPLACE FUNCTION public.admin_preview_content_graph_edge_plan(
  p_limit_per_node int DEFAULT 3,
  p_max_nodes int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_limit_per_node < 1 OR p_limit_per_node > 10 THEN
    RAISE EXCEPTION 'p_limit_per_node must be 1..10';
  END IF;
  IF p_max_nodes < 1 OR p_max_nodes > 500 THEN
    RAISE EXCEPTION 'p_max_nodes must be 1..500';
  END IF;

  WITH
  active_nodes AS (
    SELECT n.* FROM public.growth_content_graph_nodes n WHERE n.status IN ('draft','active')
  ),
  -- existing outbound edges per (from_node, edge_type)
  has_money AS (
    SELECT DISTINCT e.from_node_id FROM public.growth_content_graph_edges e WHERE e.edge_type = 'money_page'
  ),
  has_funnel AS (
    SELECT DISTINCT e.from_node_id FROM public.growth_content_graph_edges e WHERE e.edge_type = 'funnel_next'
  ),
  -- product nodes are money targets
  product_nodes AS (
    SELECT n.id, n.node_slug, n.title, n.keyword_slug, n.cluster_id, n.persona
    FROM active_nodes n WHERE n.asset_type = 'product'
  ),
  -- source nodes missing money_page (blog/landing/etc, not product itself)
  missing_money AS (
    SELECT n.* FROM active_nodes n
    WHERE n.asset_type <> 'product'
      AND n.id NOT IN (SELECT from_node_id FROM has_money)
  ),
  money_proposals AS (
    SELECT
      src.id AS from_node_id, src.node_slug AS from_slug, src.title AS from_title, src.asset_type AS from_asset,
      p.id AS to_node_id, p.node_slug AS to_slug, p.title AS to_title,
      'money_page'::text AS edge_type,
      CASE
        WHEN src.keyword_slug IS NOT NULL AND p.keyword_slug = src.keyword_slug
             AND (SELECT count(*) FROM product_nodes p2 WHERE p2.keyword_slug = src.keyword_slug) = 1
          THEN 'high'
        WHEN src.keyword_slug IS NOT NULL AND p.keyword_slug = src.keyword_slug THEN 'medium'
        WHEN src.cluster_id IS NOT NULL AND p.cluster_id = src.cluster_id THEN 'medium'
        WHEN src.persona IS NOT NULL AND p.persona = src.persona THEN 'low'
        ELSE 'low'
      END AS confidence,
      CASE
        WHEN src.keyword_slug IS NOT NULL AND p.keyword_slug = src.keyword_slug
             AND (SELECT count(*) FROM product_nodes p2 WHERE p2.keyword_slug = src.keyword_slug) = 1
          THEN 'unique keyword_slug match'
        WHEN src.keyword_slug IS NOT NULL AND p.keyword_slug = src.keyword_slug THEN 'shared keyword_slug (multi-candidate)'
        WHEN src.cluster_id IS NOT NULL AND p.cluster_id = src.cluster_id THEN 'shared cluster_id'
        WHEN src.persona IS NOT NULL AND p.persona = src.persona THEN 'persona-only fallback'
        ELSE 'generic fallback'
      END AS reason,
      ROW_NUMBER() OVER (PARTITION BY src.id ORDER BY
        CASE WHEN p.keyword_slug = src.keyword_slug THEN 0 ELSE 1 END,
        CASE WHEN p.cluster_id = src.cluster_id THEN 0 ELSE 1 END,
        CASE WHEN p.persona = src.persona THEN 0 ELSE 1 END,
        p.node_slug
      ) AS rn
    FROM missing_money src
    CROSS JOIN product_nodes p
    WHERE p.keyword_slug = src.keyword_slug
       OR p.cluster_id   = src.cluster_id
       OR p.persona      = src.persona
  ),
  money_top AS (
    SELECT * FROM money_proposals WHERE rn <= p_limit_per_node
  ),

  -- funnel_next: source missing funnel_next; target = node sharing keyword_slug/cluster, asset_type in (landing,product), distinct from src
  missing_funnel AS (
    SELECT n.* FROM active_nodes n
    WHERE n.id NOT IN (SELECT from_node_id FROM has_funnel)
  ),
  funnel_proposals AS (
    SELECT
      src.id AS from_node_id, src.node_slug AS from_slug, src.title AS from_title, src.asset_type AS from_asset,
      tgt.id AS to_node_id, tgt.node_slug AS to_slug, tgt.title AS to_title,
      'funnel_next'::text AS edge_type,
      CASE
        WHEN src.keyword_slug IS NOT NULL AND tgt.keyword_slug = src.keyword_slug
          THEN 'medium'
        WHEN src.cluster_id IS NOT NULL AND tgt.cluster_id = src.cluster_id THEN 'medium'
        ELSE 'low'
      END AS confidence,
      CASE
        WHEN src.keyword_slug IS NOT NULL AND tgt.keyword_slug = src.keyword_slug
          THEN 'shared keyword_slug, asset_type ' || tgt.asset_type
        WHEN src.cluster_id IS NOT NULL AND tgt.cluster_id = src.cluster_id
          THEN 'shared cluster_id, asset_type ' || tgt.asset_type
        ELSE 'persona-only fallback'
      END AS reason,
      ROW_NUMBER() OVER (PARTITION BY src.id ORDER BY
        CASE tgt.asset_type WHEN 'product' THEN 0 WHEN 'landing' THEN 1 ELSE 2 END,
        CASE WHEN tgt.keyword_slug = src.keyword_slug THEN 0 ELSE 1 END,
        tgt.node_slug
      ) AS rn
    FROM missing_funnel src
    JOIN active_nodes tgt ON tgt.id <> src.id
      AND tgt.asset_type IN ('landing','product','hub')
      AND (
        (src.keyword_slug IS NOT NULL AND tgt.keyword_slug = src.keyword_slug)
        OR (src.cluster_id IS NOT NULL AND tgt.cluster_id = src.cluster_id)
      )
  ),
  funnel_top AS (
    SELECT * FROM funnel_proposals WHERE rn <= p_limit_per_node
  ),

  combined AS (
    SELECT * FROM money_top
    UNION ALL
    SELECT * FROM funnel_top
  ),
  per_node AS (
    SELECT
      from_node_id, from_slug, from_title, from_asset,
      jsonb_agg(jsonb_build_object(
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
    'note', 'READ-ONLY. No edges written. Apply will be Phase 2F.'
  ) INTO v_result;

  RETURN v_result;
END $function$;

REVOKE ALL ON FUNCTION public.admin_preview_content_graph_edge_plan(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_content_graph_edge_plan(int, int) TO authenticated, service_role;