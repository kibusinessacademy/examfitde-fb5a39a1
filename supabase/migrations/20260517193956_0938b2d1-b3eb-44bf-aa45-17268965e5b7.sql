-- =========================================================================
-- 1. View: contextual diversity per source node (Shannon entropy + distinct targets)
-- =========================================================================
CREATE OR REPLACE VIEW public.v_seo_node_contextual_diversity AS
WITH ctx AS (
  SELECT source_url, target_url, COUNT(*) AS edge_count
  FROM public.seo_internal_link_suggestions
  WHERE status='active' AND link_type='contextual'
  GROUP BY source_url, target_url
),
per_src AS (
  SELECT source_url, SUM(edge_count) AS total_edges
  FROM ctx GROUP BY source_url
),
shannon AS (
  SELECT c.source_url,
         -SUM( (c.edge_count::numeric / p.total_edges) *
               LN(c.edge_count::numeric / p.total_edges) ) AS entropy_nats,
         COUNT(*) AS distinct_targets,
         SUM(c.edge_count) AS contextual_outbound
  FROM ctx c JOIN per_src p ON p.source_url = c.source_url
  GROUP BY c.source_url
)
SELECT
  source_url,
  contextual_outbound,
  distinct_targets,
  ROUND(entropy_nats::numeric, 4) AS entropy_nats,
  -- Normalize against max possible entropy = ln(distinct_targets)
  CASE WHEN distinct_targets > 1
       THEN ROUND( (entropy_nats / LN(distinct_targets))::numeric, 4)
       ELSE 0 END AS diversity_score,
  CASE
    WHEN distinct_targets <= 2 THEN 'very_low'
    WHEN distinct_targets <= 5 THEN 'low'
    WHEN distinct_targets <= 15 THEN 'moderate'
    ELSE 'high'
  END AS diversity_tier
FROM shannon;

-- =========================================================================
-- 2. View: hop-depth from each node to nearest pillar (BFS, bounded depth 6)
--    Edges treated as undirected for reach computation.
-- =========================================================================
CREATE OR REPLACE VIEW public.v_seo_node_reach AS
WITH RECURSIVE
edges AS (
  SELECT source_url AS a, target_url AS b
  FROM public.seo_internal_link_suggestions
  WHERE status='active'
  UNION
  SELECT target_url AS a, source_url AS b
  FROM public.seo_internal_link_suggestions
  WHERE status='active'
),
pillars AS (
  SELECT url FROM public.v_seo_graph_node_metrics WHERE node_role='pillar'
),
bfs AS (
  SELECT url AS node_url, url AS via_pillar, 0 AS depth
  FROM pillars
  UNION
  SELECT e.b AS node_url, b.via_pillar, b.depth + 1
  FROM bfs b
  JOIN edges e ON e.a = b.node_url
  WHERE b.depth < 6
),
collapsed AS (
  SELECT node_url, MIN(depth) AS min_depth
  FROM bfs GROUP BY node_url
)
SELECT
  n.url AS node_url,
  n.node_role,
  COALESCE(c.min_depth, 99) AS hop_depth_to_pillar,
  CASE
    WHEN c.min_depth IS NULL THEN 'unreachable'
    WHEN c.min_depth = 0 THEN 'is_pillar'
    WHEN c.min_depth = 1 THEN 'direct'
    WHEN c.min_depth <= 2 THEN 'shallow'
    WHEN c.min_depth <= 4 THEN 'moderate'
    ELSE 'deep'
  END AS reach_tier
FROM public.v_seo_graph_node_metrics n
LEFT JOIN collapsed c ON c.node_url = n.url;

-- =========================================================================
-- 3. View: weighted pillar authority (richer than v_seo_pillar_authority)
-- =========================================================================
CREATE OR REPLACE VIEW public.v_seo_pillar_authority_weighted AS
SELECT
  pa.pillar_url,
  pa.inbound_total,
  pa.inbound_from_spokes,
  pa.inbound_contextual,
  pa.outbound_total,
  pa.authority_tier,
  pa.authority_score AS base_score,
  -- Weighted: spokes(1.0) + contextual(0.5) + pillar-to-cluster reach bonus(0.25)
  ROUND( (pa.inbound_from_spokes * 1.0
        + pa.inbound_contextual * 0.5
        + LEAST(pa.outbound_to_spokes, 25) * 0.25)::numeric, 2) AS weighted_authority,
  -- contextual share of inbound — semantic vs structural balance
  CASE WHEN pa.inbound_total > 0
       THEN ROUND( (pa.inbound_contextual::numeric / pa.inbound_total) * 100, 2)
       ELSE 0 END AS contextual_inbound_pct
FROM public.v_seo_pillar_authority pa;

-- =========================================================================
-- 4. View: per-node pattern flags
-- =========================================================================
CREATE OR REPLACE VIEW public.v_seo_graph_patterns AS
WITH n AS (SELECT * FROM public.v_seo_graph_node_metrics),
div AS (SELECT * FROM public.v_seo_node_contextual_diversity),
reach AS (SELECT * FROM public.v_seo_node_reach)
SELECT
  n.url,
  n.node_role,
  n.inbound_total,
  n.outbound_total,
  n.in_contextual,
  n.out_contextual,
  COALESCE(d.diversity_score, 0) AS contextual_diversity,
  COALESCE(d.distinct_targets, 0) AS contextual_distinct_targets,
  r.hop_depth_to_pillar,
  r.reach_tier,
  -- pattern flags
  (n.in_contextual > 0 AND n.out_contextual = 0)
    AS one_way_contextual,
  (n.outbound_total = 0 AND n.node_role IN ('spoke','contextual_node'))
    AS cluster_deadend,
  (n.inbound_total >= 30 AND COALESCE(d.diversity_score,0) < 0.5)
    AS overlinked_hub,
  (n.node_role IN ('spoke','contextual_node')
    AND COALESCE(d.contextual_outbound,0) <= 2 AND n.out_contextual <= 2)
    AS low_contextual_degree,
  (r.hop_depth_to_pillar >= 5 OR r.reach_tier = 'unreachable')
    AS certification_island,
  (n.in_contextual = 0 AND n.out_contextual = 0
    AND (n.in_cluster_to_pillar > 0 OR n.in_pillar_to_cluster > 0
         OR n.out_cluster_to_pillar > 0 OR n.out_pillar_to_cluster > 0))
    AS structural_only
FROM n
LEFT JOIN div d   ON d.source_url = n.url
LEFT JOIN reach r ON r.node_url   = n.url;

-- =========================================================================
-- 5. View: global recon summary (pillar coverage entropy, avg hop, pattern counts)
-- =========================================================================
CREATE OR REPLACE VIEW public.v_seo_graph_authority_summary AS
WITH pa AS (SELECT * FROM public.v_seo_pillar_authority_weighted),
pa_total AS (SELECT NULLIF(SUM(weighted_authority),0) AS s FROM pa),
ent AS (
  SELECT CASE
    WHEN (SELECT s FROM pa_total) IS NULL THEN 0
    ELSE -SUM( (weighted_authority::numeric / (SELECT s FROM pa_total)) *
                LN(GREATEST(weighted_authority::numeric / (SELECT s FROM pa_total), 1e-9)) )
    END AS pillar_coverage_entropy
  FROM pa WHERE weighted_authority > 0
),
r AS (SELECT * FROM public.v_seo_node_reach),
p AS (SELECT * FROM public.v_seo_graph_patterns)
SELECT
  (SELECT COUNT(*) FROM pa) AS pillars_analyzed,
  (SELECT ROUND(pillar_coverage_entropy::numeric, 4) FROM ent) AS pillar_coverage_entropy,
  (SELECT ROUND(AVG(hop_depth_to_pillar)::numeric, 2) FROM r WHERE hop_depth_to_pillar < 99) AS avg_hop_depth,
  (SELECT MAX(hop_depth_to_pillar) FROM r WHERE hop_depth_to_pillar < 99) AS max_hop_depth,
  (SELECT COUNT(*) FROM r WHERE reach_tier='unreachable') AS unreachable_nodes,
  (SELECT COUNT(*) FROM r WHERE reach_tier='deep') AS deep_nodes,
  (SELECT COUNT(*) FROM p WHERE one_way_contextual)      AS pattern_one_way_contextual,
  (SELECT COUNT(*) FROM p WHERE cluster_deadend)         AS pattern_cluster_deadend,
  (SELECT COUNT(*) FROM p WHERE overlinked_hub)          AS pattern_overlinked_hub,
  (SELECT COUNT(*) FROM p WHERE low_contextual_degree)   AS pattern_low_contextual_degree,
  (SELECT COUNT(*) FROM p WHERE certification_island)    AS pattern_certification_island,
  (SELECT COUNT(*) FROM p WHERE structural_only)         AS pattern_structural_only,
  NOW() AS snapshot_at;

-- =========================================================================
-- 6. Lock views + grant
-- =========================================================================
REVOKE ALL ON public.v_seo_node_contextual_diversity   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_seo_node_reach                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_seo_pillar_authority_weighted   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_seo_graph_patterns              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_seo_graph_authority_summary     FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_seo_node_contextual_diversity,
                public.v_seo_node_reach,
                public.v_seo_pillar_authority_weighted,
                public.v_seo_graph_patterns,
                public.v_seo_graph_authority_summary
  TO service_role;

-- =========================================================================
-- 7. Admin RPCs
-- =========================================================================
CREATE OR REPLACE FUNCTION public.admin_get_seo_graph_recon_summary()
RETURNS SETOF public.v_seo_graph_authority_summary
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.v_seo_graph_authority_summary
  WHERE public.has_role(auth.uid(), 'admin');
$$;

CREATE OR REPLACE FUNCTION public.admin_get_seo_pillar_authority_weighted(p_limit int DEFAULT 50)
RETURNS SETOF public.v_seo_pillar_authority_weighted
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.v_seo_pillar_authority_weighted
  WHERE public.has_role(auth.uid(), 'admin')
  ORDER BY weighted_authority DESC
  LIMIT GREATEST(COALESCE(p_limit,50), 1);
$$;

CREATE OR REPLACE FUNCTION public.admin_get_seo_node_diversity(p_limit int DEFAULT 100, p_tier text DEFAULT NULL)
RETURNS SETOF public.v_seo_node_contextual_diversity
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.v_seo_node_contextual_diversity
  WHERE public.has_role(auth.uid(), 'admin')
    AND (p_tier IS NULL OR diversity_tier = p_tier)
  ORDER BY diversity_score ASC, contextual_outbound DESC
  LIMIT GREATEST(COALESCE(p_limit,100), 1);
$$;

CREATE OR REPLACE FUNCTION public.admin_get_seo_node_reach(p_limit int DEFAULT 200, p_tier text DEFAULT NULL)
RETURNS SETOF public.v_seo_node_reach
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.v_seo_node_reach
  WHERE public.has_role(auth.uid(), 'admin')
    AND (p_tier IS NULL OR reach_tier = p_tier)
  ORDER BY hop_depth_to_pillar DESC, node_url
  LIMIT GREATEST(COALESCE(p_limit,200), 1);
$$;

CREATE OR REPLACE FUNCTION public.admin_get_seo_graph_patterns(p_pattern text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS SETOF public.v_seo_graph_patterns
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.v_seo_graph_patterns
  WHERE public.has_role(auth.uid(), 'admin')
    AND (
      p_pattern IS NULL
      OR (p_pattern = 'one_way_contextual'      AND one_way_contextual)
      OR (p_pattern = 'cluster_deadend'         AND cluster_deadend)
      OR (p_pattern = 'overlinked_hub'          AND overlinked_hub)
      OR (p_pattern = 'low_contextual_degree'   AND low_contextual_degree)
      OR (p_pattern = 'certification_island'    AND certification_island)
      OR (p_pattern = 'structural_only'         AND structural_only)
    )
  ORDER BY inbound_total + outbound_total DESC
  LIMIT GREATEST(COALESCE(p_limit,200), 1);
$$;

REVOKE ALL ON FUNCTION public.admin_get_seo_graph_recon_summary()                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_seo_pillar_authority_weighted(int)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_seo_node_diversity(int, text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_seo_node_reach(int, text)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_seo_graph_patterns(text, int)            FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_seo_graph_recon_summary(),
                          public.admin_get_seo_pillar_authority_weighted(int),
                          public.admin_get_seo_node_diversity(int, text),
                          public.admin_get_seo_node_reach(int, text),
                          public.admin_get_seo_graph_patterns(text, int)
  TO authenticated, service_role;

-- =========================================================================
-- 8. Audit contract + baseline snapshot
-- =========================================================================
INSERT INTO public.ops_audit_contract (action_type, owner_module, required_keys)
VALUES ('seo_graph_recon_snapshot', 'seo_blog_publish',
        ARRAY['phase','summary','trigger_source']::text[])
ON CONFLICT (action_type) DO NOTHING;

DO $$
DECLARE v_summary jsonb;
BEGIN
  SELECT to_jsonb(s) INTO v_summary FROM public.v_seo_graph_authority_summary s LIMIT 1;
  PERFORM public.fn_emit_audit(
    _action_type := 'seo_graph_recon_snapshot',
    _payload := jsonb_build_object(
      'phase','e3d_2b_semantic_recon_baseline',
      'summary', v_summary,
      'trigger_source','e3d_2b_migration'
    )
  );
END $$;