-- E3d.3 — SEO Graph Impact Measurement SSOT
CREATE OR REPLACE VIEW public.v_seo_graph_node_metrics AS
WITH edges AS (
  SELECT source_url, target_url, link_type
  FROM public.seo_internal_link_suggestions
  WHERE status = 'active'
),
out_edges AS (
  SELECT source_url AS url,
         COUNT(*) AS outbound_total,
         COUNT(*) FILTER (WHERE link_type='cluster_to_pillar')  AS out_cluster_to_pillar,
         COUNT(*) FILTER (WHERE link_type='pillar_to_cluster')  AS out_pillar_to_cluster,
         COUNT(*) FILTER (WHERE link_type='cluster_to_cluster') AS out_cluster_to_cluster,
         COUNT(*) FILTER (WHERE link_type='contextual')         AS out_contextual,
         COUNT(*) FILTER (WHERE link_type='cluster_to_product') AS out_cluster_to_product
  FROM edges GROUP BY 1
),
in_edges AS (
  SELECT target_url AS url,
         COUNT(*) AS inbound_total,
         COUNT(*) FILTER (WHERE link_type='cluster_to_pillar')  AS in_cluster_to_pillar,
         COUNT(*) FILTER (WHERE link_type='pillar_to_cluster')  AS in_pillar_to_cluster,
         COUNT(*) FILTER (WHERE link_type='cluster_to_cluster') AS in_cluster_to_cluster,
         COUNT(*) FILTER (WHERE link_type='contextual')         AS in_contextual,
         COUNT(*) FILTER (WHERE link_type='cluster_to_product') AS in_cluster_to_product
  FROM edges GROUP BY 1
),
nodes AS (
  SELECT url FROM out_edges
  UNION
  SELECT url FROM in_edges
)
SELECT
  n.url,
  CASE
    WHEN COALESCE(o.out_pillar_to_cluster,0) > 0 OR COALESCE(i.in_cluster_to_pillar,0) > 0 THEN 'pillar'
    WHEN COALESCE(o.out_cluster_to_pillar,0) > 0 OR COALESCE(i.in_pillar_to_cluster,0) > 0 THEN 'spoke'
    WHEN COALESCE(o.out_contextual,0) > 0 OR COALESCE(i.in_contextual,0) > 0 THEN 'contextual_node'
    ELSE 'other'
  END AS node_role,
  COALESCE(o.outbound_total,0) AS outbound_total,
  COALESCE(i.inbound_total,0)  AS inbound_total,
  COALESCE(o.out_cluster_to_pillar,0)  AS out_cluster_to_pillar,
  COALESCE(o.out_pillar_to_cluster,0)  AS out_pillar_to_cluster,
  COALESCE(o.out_cluster_to_cluster,0) AS out_cluster_to_cluster,
  COALESCE(o.out_contextual,0)         AS out_contextual,
  COALESCE(o.out_cluster_to_product,0) AS out_cluster_to_product,
  COALESCE(i.in_cluster_to_pillar,0)   AS in_cluster_to_pillar,
  COALESCE(i.in_pillar_to_cluster,0)   AS in_pillar_to_cluster,
  COALESCE(i.in_cluster_to_cluster,0)  AS in_cluster_to_cluster,
  COALESCE(i.in_contextual,0)          AS in_contextual,
  COALESCE(i.in_cluster_to_product,0)  AS in_cluster_to_product
FROM nodes n
LEFT JOIN out_edges o ON o.url = n.url
LEFT JOIN in_edges  i ON i.url = n.url;

CREATE OR REPLACE VIEW public.v_seo_graph_metrics AS
WITH e AS (SELECT link_type FROM public.seo_internal_link_suggestions WHERE status='active'),
n AS (SELECT * FROM public.v_seo_graph_node_metrics)
SELECT
  (SELECT COUNT(*) FROM e) AS edges_total,
  (SELECT COUNT(*) FILTER (WHERE link_type='cluster_to_pillar')  FROM e) AS edges_cluster_to_pillar,
  (SELECT COUNT(*) FILTER (WHERE link_type='pillar_to_cluster')  FROM e) AS edges_pillar_to_cluster,
  (SELECT COUNT(*) FILTER (WHERE link_type='cluster_to_cluster') FROM e) AS edges_cluster_to_cluster,
  (SELECT COUNT(*) FILTER (WHERE link_type='contextual')         FROM e) AS edges_contextual,
  (SELECT COUNT(*) FILTER (WHERE link_type='cluster_to_product') FROM e) AS edges_cluster_to_product,
  (SELECT COUNT(*) FROM n) AS nodes_total,
  (SELECT COUNT(*) FILTER (WHERE node_role='pillar') FROM n) AS pillars_total,
  (SELECT COUNT(*) FILTER (WHERE node_role='spoke') FROM n) AS spokes_total,
  (SELECT COUNT(*) FILTER (WHERE inbound_total=0) FROM n) AS nodes_no_inbound,
  (SELECT COUNT(*) FILTER (WHERE outbound_total=0) FROM n) AS nodes_no_outbound,
  (SELECT COUNT(*) FILTER (WHERE inbound_total=0 AND outbound_total=0) FROM n) AS nodes_orphan,
  (SELECT ROUND(AVG(inbound_total)::numeric, 2) FROM n) AS avg_inbound,
  (SELECT ROUND(AVG(outbound_total)::numeric, 2) FROM n) AS avg_outbound,
  (SELECT MAX(inbound_total) FROM n)  AS max_inbound,
  (SELECT MAX(outbound_total) FROM n) AS max_outbound,
  CASE WHEN (SELECT COUNT(*) FROM e) > 0
       THEN ROUND(((SELECT COUNT(*) FILTER (WHERE link_type='contextual') FROM e)::numeric
                   / (SELECT COUNT(*) FROM e)::numeric) * 100, 2)
       ELSE 0 END AS contextual_ratio_pct,
  NOW() AS snapshot_at;

CREATE OR REPLACE VIEW public.v_seo_pillar_authority AS
SELECT
  url AS pillar_url,
  inbound_total,
  in_cluster_to_pillar  AS inbound_from_spokes,
  in_contextual         AS inbound_contextual,
  outbound_total,
  out_pillar_to_cluster AS outbound_to_spokes,
  CASE
    WHEN inbound_total >= 20 AND outbound_total >= 5 THEN 'strong_hub'
    WHEN inbound_total >= 10 THEN 'moderate_hub'
    WHEN inbound_total >= 3  THEN 'weak_hub'
    ELSE 'isolated_pillar'
  END AS authority_tier,
  (in_cluster_to_pillar
   + in_contextual * 0.5
   + LEAST(out_pillar_to_cluster, 20) * 0.25)::numeric AS authority_score
FROM public.v_seo_graph_node_metrics
WHERE node_role = 'pillar';

CREATE OR REPLACE VIEW public.v_seo_orphan_analysis AS
SELECT
  url, node_role, inbound_total, outbound_total,
  CASE
    WHEN inbound_total = 0 AND outbound_total = 0 THEN 'full_orphan'
    WHEN inbound_total = 0 THEN 'no_inbound'
    WHEN outbound_total = 0 THEN 'no_outbound'
    ELSE 'connected'
  END AS orphan_class
FROM public.v_seo_graph_node_metrics
WHERE inbound_total = 0 OR outbound_total = 0;

CREATE OR REPLACE VIEW public.v_seo_contextual_density AS
SELECT
  source_url,
  COUNT(*) AS contextual_outbound,
  COUNT(DISTINCT target_url) AS distinct_targets,
  ROUND(AVG(COALESCE(relevance_score,0))::numeric, 2) AS avg_relevance
FROM public.seo_internal_link_suggestions
WHERE status='active' AND link_type='contextual'
GROUP BY source_url;

CREATE OR REPLACE VIEW public.v_seo_graph_hubs AS
SELECT
  url, node_role, inbound_total, outbound_total,
  (inbound_total + outbound_total) AS total_degree
FROM public.v_seo_graph_node_metrics
ORDER BY total_degree DESC;

REVOKE ALL ON public.v_seo_graph_node_metrics  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_seo_graph_metrics       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_seo_pillar_authority    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_seo_orphan_analysis     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_seo_contextual_density  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_seo_graph_hubs          FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_seo_graph_node_metrics, public.v_seo_graph_metrics,
                public.v_seo_pillar_authority, public.v_seo_orphan_analysis,
                public.v_seo_contextual_density, public.v_seo_graph_hubs
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_seo_graph_metrics()
RETURNS SETOF public.v_seo_graph_metrics
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.v_seo_graph_metrics
  WHERE public.has_role(auth.uid(), 'admin');
$$;

CREATE OR REPLACE FUNCTION public.admin_get_pillar_authority(p_limit int DEFAULT 50)
RETURNS SETOF public.v_seo_pillar_authority
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.v_seo_pillar_authority
  WHERE public.has_role(auth.uid(), 'admin')
  ORDER BY authority_score DESC
  LIMIT GREATEST(COALESCE(p_limit,50), 1);
$$;

CREATE OR REPLACE FUNCTION public.admin_get_graph_orphans(p_limit int DEFAULT 200)
RETURNS SETOF public.v_seo_orphan_analysis
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.v_seo_orphan_analysis
  WHERE public.has_role(auth.uid(), 'admin')
  ORDER BY orphan_class, url
  LIMIT GREATEST(COALESCE(p_limit,200), 1);
$$;

CREATE OR REPLACE FUNCTION public.admin_get_contextual_density(p_limit int DEFAULT 100)
RETURNS SETOF public.v_seo_contextual_density
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.v_seo_contextual_density
  WHERE public.has_role(auth.uid(), 'admin')
  ORDER BY contextual_outbound DESC
  LIMIT GREATEST(COALESCE(p_limit,100), 1);
$$;

CREATE OR REPLACE FUNCTION public.admin_get_seo_graph_hubs(p_limit int DEFAULT 50)
RETURNS SETOF public.v_seo_graph_hubs
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.v_seo_graph_hubs
  WHERE public.has_role(auth.uid(), 'admin')
  LIMIT GREATEST(COALESCE(p_limit,50), 1);
$$;

REVOKE ALL ON FUNCTION public.admin_get_seo_graph_metrics()     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_pillar_authority(int)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_graph_orphans(int)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_contextual_density(int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_seo_graph_hubs(int)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_seo_graph_metrics(),
                          public.admin_get_pillar_authority(int),
                          public.admin_get_graph_orphans(int),
                          public.admin_get_contextual_density(int),
                          public.admin_get_seo_graph_hubs(int)
  TO authenticated, service_role;

INSERT INTO public.ops_audit_contract (action_type, owner_module, required_keys)
VALUES ('seo_graph_impact_snapshot', 'seo_blog_publish',
        ARRAY['phase','metrics','trigger_source']::text[])
ON CONFLICT (action_type) DO NOTHING;

DO $$
DECLARE v_metrics jsonb;
BEGIN
  SELECT to_jsonb(m) INTO v_metrics FROM public.v_seo_graph_metrics m LIMIT 1;
  PERFORM public.fn_emit_audit(
    _action_type := 'seo_graph_impact_snapshot',
    _payload := jsonb_build_object(
      'phase','e3d_3_post_materialization_baseline',
      'metrics', v_metrics,
      'trigger_source','e3d_3_migration'
    )
  );
END $$;