
-- P1 — E3e Bridging Completion

CREATE OR REPLACE VIEW public.v_unreachable_semantic_nodes AS
WITH all_nodes AS (
  SELECT source_url AS url FROM public.seo_internal_link_suggestions WHERE status='active'
  UNION
  SELECT target_url AS url FROM public.seo_internal_link_suggestions WHERE status='active'
),
in_bridge AS (
  SELECT target_url, COUNT(*) AS n
  FROM public.seo_internal_link_suggestions
  WHERE status='active'
    AND link_type IN ('pillar_contextual_bridge','cluster_to_pillar','pillar_to_cluster','cluster_to_cluster')
  GROUP BY target_url
)
SELECT n.url,
       COALESCE(ib.n,0) AS inbound_bridge_count,
       CASE
         WHEN n.url LIKE '/blog/%'   THEN 'contextual'
         WHEN n.url LIKE '/paket/%'  THEN 'product'
         WHEN n.url LIKE '/wissen/%' THEN 'pillar'
         WHEN n.url LIKE '/pruefungstraining/%' THEN 'spoke'
         ELSE 'other'
       END AS node_role
FROM all_nodes n
LEFT JOIN in_bridge ib ON ib.target_url = n.url
WHERE COALESCE(ib.n,0) = 0;

REVOKE ALL ON public.v_unreachable_semantic_nodes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_unreachable_semantic_nodes TO service_role;

CREATE OR REPLACE VIEW public.v_e3e_bridge_health AS
SELECT
  (SELECT COUNT(*) FROM public.v_pillar_contextual_bridge_candidates) AS candidates_total,
  (SELECT ROUND(AVG(bridge_score)::numeric, 2) FROM public.v_pillar_contextual_bridge_candidates) AS avg_bridge_score,
  (SELECT COUNT(*) FROM public.seo_internal_link_suggestions
    WHERE link_type='pillar_contextual_bridge' AND status='active') AS materialised_total,
  (SELECT COUNT(*) FROM public.v_unreachable_semantic_nodes) AS unreachable_nodes_total,
  (SELECT COUNT(*) FROM public.v_unreachable_semantic_nodes WHERE node_role='contextual') AS unreachable_contextual,
  (SELECT COUNT(*) FROM public.v_unreachable_semantic_nodes WHERE node_role='pillar') AS unreachable_pillar,
  now() AS snapshot_at;

REVOKE ALL ON public.v_e3e_bridge_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_e3e_bridge_health TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_e3e_bridge_health()
RETURNS TABLE(candidates_total bigint, avg_bridge_score numeric, materialised_total bigint,
              unreachable_nodes_total bigint, unreachable_contextual bigint, unreachable_pillar bigint,
              snapshot_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  SELECT candidates_total, avg_bridge_score, materialised_total,
         unreachable_nodes_total, unreachable_contextual, unreachable_pillar, snapshot_at
  FROM public.v_e3e_bridge_health
  WHERE public.has_role(auth.uid(),'admin'::app_role);
$$;
REVOKE ALL ON FUNCTION public.admin_get_e3e_bridge_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_e3e_bridge_health() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_e3e_heal_unreachable_nodes(
  p_cap int DEFAULT 50,
  p_min_score int DEFAULT 20,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(inserted_count int, scanned_candidates int, dry_run boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_inserted int := 0;
  v_scanned int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  p_cap := LEAST(GREATEST(p_cap,1), 100);

  WITH cand AS (
    SELECT c.blog_url, c.pillar_url, c.bridge_score, c.evidence
    FROM public.v_pillar_contextual_bridge_candidates c
    JOIN public.v_unreachable_semantic_nodes un ON un.url = c.blog_url
    WHERE c.bridge_score >= p_min_score
    ORDER BY c.bridge_score DESC NULLS LAST
    LIMIT p_cap
  ),
  ins AS (
    INSERT INTO public.seo_internal_link_suggestions
      (source_url, target_url, link_type, status, score, evidence, created_at)
    SELECT pillar_url, blog_url, 'pillar_contextual_bridge',
           CASE WHEN p_dry_run THEN 'dry_run' ELSE 'active' END,
           bridge_score, evidence, now()
    FROM cand
    WHERE NOT EXISTS (
      SELECT 1 FROM public.seo_internal_link_suggestions s
      WHERE s.source_url = cand.pillar_url AND s.target_url = cand.blog_url
        AND s.link_type='pillar_contextual_bridge')
    RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM ins)::int, (SELECT COUNT(*) FROM cand)::int
  INTO v_inserted, v_scanned;

  PERFORM public.fn_emit_audit(
    _action_type := 'e3e_unreachable_heal_run',
    _payload := jsonb_build_object(
      'inserted_count', v_inserted, 'scanned_candidates', v_scanned,
      'dry_run', p_dry_run, 'min_score', p_min_score, 'cap', p_cap));

  inserted_count := v_inserted; scanned_candidates := v_scanned; dry_run := p_dry_run;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_e3e_heal_unreachable_nodes(int,int,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_e3e_heal_unreachable_nodes(int,int,boolean) TO authenticated;

INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module)
VALUES ('e3e_unreachable_heal_run',
        ARRAY['inserted_count','scanned_candidates','dry_run','min_score','cap'],
        'seo_semantic_bridging')
ON CONFLICT (action_type) DO NOTHING;

SELECT public.fn_emit_audit(
  _action_type := 'e3e_unreachable_heal_run',
  _payload := jsonb_build_object('inserted_count',0,'scanned_candidates',0,
              'dry_run',true,'min_score',20,'cap',0,'phase','baseline'));
