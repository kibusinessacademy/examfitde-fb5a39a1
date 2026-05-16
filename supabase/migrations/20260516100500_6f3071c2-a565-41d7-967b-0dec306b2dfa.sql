
-- skill_dependency_edges
CREATE TABLE IF NOT EXISTS public.skill_dependency_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_competency_id uuid NOT NULL,
  target_competency_id uuid NOT NULL,
  edge_type text NOT NULL CHECK (edge_type IN ('prerequisite','blocks','transfer','co_occurs')),
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  sample_size integer NOT NULL DEFAULT 0,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'empirical' CHECK (source IN ('empirical','curriculum','manual','hybrid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_competency_id, target_competency_id, edge_type)
);
CREATE INDEX IF NOT EXISTS idx_skill_dep_target ON public.skill_dependency_edges (target_competency_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_skill_dep_source ON public.skill_dependency_edges (source_competency_id, edge_type);
ALTER TABLE public.skill_dependency_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full skill_dependency_edges" ON public.skill_dependency_edges FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
CREATE POLICY "admin read skill_dependency_edges" ON public.skill_dependency_edges FOR SELECT USING (public.has_role(auth.uid(),'admin'));

-- competency_transfer_patterns
CREATE TABLE IF NOT EXISTS public.competency_transfer_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_competency_id uuid NOT NULL,
  target_competency_id uuid NOT NULL,
  transfer_score numeric NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  observed_lift_pp numeric,
  pattern_type text NOT NULL DEFAULT 'mastery_transfer' CHECK (pattern_type IN ('mastery_transfer','recovery_transfer','negative_transfer','none')),
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_competency_id, target_competency_id, pattern_type)
);
CREATE INDEX IF NOT EXISTS idx_transfer_source ON public.competency_transfer_patterns (source_competency_id);
CREATE INDEX IF NOT EXISTS idx_transfer_target ON public.competency_transfer_patterns (target_competency_id);
ALTER TABLE public.competency_transfer_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full transfer_patterns" ON public.competency_transfer_patterns FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
CREATE POLICY "admin read transfer_patterns" ON public.competency_transfer_patterns FOR SELECT USING (public.has_role(auth.uid(),'admin'));

-- kg_competency_nodes (skill-dependency centrality; separate from existing knowledge_graph_nodes SSOT)
CREATE TABLE IF NOT EXISTS public.kg_competency_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competency_id uuid NOT NULL UNIQUE,
  node_role text NOT NULL DEFAULT 'leaf' CHECK (node_role IN ('hub','bottleneck','bridge','leaf','isolated')),
  in_degree integer NOT NULL DEFAULT 0,
  out_degree integer NOT NULL DEFAULT 0,
  centrality_score numeric NOT NULL DEFAULT 0,
  blocks_count integer NOT NULL DEFAULT 0,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kgcn_role ON public.kg_competency_nodes (node_role);
CREATE INDEX IF NOT EXISTS idx_kgcn_blocks ON public.kg_competency_nodes (blocks_count DESC);
ALTER TABLE public.kg_competency_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full kg_competency_nodes" ON public.kg_competency_nodes FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
CREATE POLICY "admin read kg_competency_nodes" ON public.kg_competency_nodes FOR SELECT USING (public.has_role(auth.uid(),'admin'));

-- Views
CREATE OR REPLACE VIEW public.v_skill_bottlenecks AS
SELECT competency_id, node_role, blocks_count, out_degree, in_degree, centrality_score, updated_at
FROM public.kg_competency_nodes
WHERE node_role IN ('bottleneck','hub') OR blocks_count >= 3
ORDER BY blocks_count DESC, centrality_score DESC;
REVOKE ALL ON public.v_skill_bottlenecks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_skill_bottlenecks TO service_role;

CREATE OR REPLACE VIEW public.v_hidden_dependency_risks AS
SELECT source_competency_id AS prerequisite_competency_id,
       target_competency_id AS dependent_competency_id,
       confidence, sample_size, edge_type, signals
FROM public.skill_dependency_edges
WHERE edge_type IN ('prerequisite','blocks') AND confidence >= 0.6 AND sample_size >= 10
ORDER BY confidence DESC, sample_size DESC;
REVOKE ALL ON public.v_hidden_dependency_risks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_hidden_dependency_risks TO service_role;

CREATE OR REPLACE VIEW public.v_competency_transfer_effects AS
SELECT source_competency_id,
       COUNT(*)::int AS targets_affected,
       AVG(transfer_score)::numeric AS avg_transfer_score,
       AVG(observed_lift_pp)::numeric AS avg_lift_pp,
       SUM(sample_size)::int AS total_sample_size,
       MAX(computed_at) AS last_computed_at
FROM public.competency_transfer_patterns
WHERE pattern_type IN ('mastery_transfer','recovery_transfer')
GROUP BY source_competency_id
ORDER BY AVG(transfer_score) DESC NULLS LAST;
REVOKE ALL ON public.v_competency_transfer_effects FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_competency_transfer_effects TO service_role;

-- Recompute RPC (idempotent)
CREATE OR REPLACE FUNCTION public.fn_recompute_kg_competency_nodes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_started timestamptz := now();
BEGIN
  WITH all_comps AS (
    SELECT source_competency_id AS competency_id FROM public.skill_dependency_edges
    UNION
    SELECT target_competency_id FROM public.skill_dependency_edges
  ),
  degrees AS (
    SELECT
      c.competency_id,
      COALESCE((SELECT COUNT(*) FROM public.skill_dependency_edges e WHERE e.target_competency_id=c.competency_id), 0)::int AS in_deg,
      COALESCE((SELECT COUNT(*) FROM public.skill_dependency_edges e WHERE e.source_competency_id=c.competency_id), 0)::int AS out_deg,
      COALESCE((SELECT COUNT(*) FROM public.skill_dependency_edges e
                 WHERE e.source_competency_id=c.competency_id
                   AND e.edge_type IN ('prerequisite','blocks')), 0)::int AS blocks_cnt
    FROM all_comps c
  ),
  upsert AS (
    INSERT INTO public.kg_competency_nodes
      (competency_id, in_degree, out_degree, blocks_count, node_role, centrality_score, updated_at)
    SELECT
      d.competency_id, d.in_deg, d.out_deg, d.blocks_cnt,
      CASE
        WHEN d.blocks_cnt >= 5 THEN 'bottleneck'
        WHEN d.in_deg + d.out_deg >= 8 THEN 'hub'
        WHEN d.in_deg >= 2 AND d.out_deg >= 2 THEN 'bridge'
        WHEN d.in_deg = 0 AND d.out_deg = 0 THEN 'isolated'
        ELSE 'leaf'
      END,
      (d.in_deg + d.out_deg + d.blocks_cnt*2)::numeric,
      now()
    FROM degrees d
    ON CONFLICT (competency_id) DO UPDATE
      SET in_degree=EXCLUDED.in_degree,
          out_degree=EXCLUDED.out_degree,
          blocks_count=EXCLUDED.blocks_count,
          node_role=EXCLUDED.node_role,
          centrality_score=EXCLUDED.centrality_score,
          updated_at=now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upsert;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, payload)
  VALUES ('kg_competency_nodes_recomputed','system','success',
    jsonb_build_object('nodes_upserted', v_count,
      'duration_ms', EXTRACT(MILLISECONDS FROM (now()-v_started))::int));

  RETURN jsonb_build_object('ok', true, 'nodes_upserted', v_count, 'computed_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.fn_recompute_kg_competency_nodes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_recompute_kg_competency_nodes() TO service_role;

-- Admin summary
CREATE OR REPLACE FUNCTION public.admin_get_skill_graph_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'edges', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM public.skill_dependency_edges),
      'prerequisite', (SELECT COUNT(*) FROM public.skill_dependency_edges WHERE edge_type='prerequisite'),
      'blocks', (SELECT COUNT(*) FROM public.skill_dependency_edges WHERE edge_type='blocks'),
      'transfer', (SELECT COUNT(*) FROM public.skill_dependency_edges WHERE edge_type='transfer'),
      'co_occurs', (SELECT COUNT(*) FROM public.skill_dependency_edges WHERE edge_type='co_occurs'),
      'high_confidence', (SELECT COUNT(*) FROM public.skill_dependency_edges WHERE confidence>=0.7 AND sample_size>=10)
    ),
    'nodes', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM public.kg_competency_nodes),
      'bottlenecks', (SELECT COUNT(*) FROM public.kg_competency_nodes WHERE node_role='bottleneck'),
      'hubs', (SELECT COUNT(*) FROM public.kg_competency_nodes WHERE node_role='hub'),
      'bridges', (SELECT COUNT(*) FROM public.kg_competency_nodes WHERE node_role='bridge'),
      'isolated', (SELECT COUNT(*) FROM public.kg_competency_nodes WHERE node_role='isolated')
    ),
    'transfer_patterns', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM public.competency_transfer_patterns),
      'mastery', (SELECT COUNT(*) FROM public.competency_transfer_patterns WHERE pattern_type='mastery_transfer'),
      'recovery', (SELECT COUNT(*) FROM public.competency_transfer_patterns WHERE pattern_type='recovery_transfer'),
      'negative', (SELECT COUNT(*) FROM public.competency_transfer_patterns WHERE pattern_type='negative_transfer')
    ),
    'top_bottlenecks', COALESCE((SELECT jsonb_agg(row_to_json(b)) FROM (
      SELECT competency_id, blocks_count, out_degree, centrality_score
      FROM public.kg_competency_nodes
      WHERE node_role='bottleneck' OR blocks_count>=3
      ORDER BY blocks_count DESC, centrality_score DESC LIMIT 10) b), '[]'::jsonb),
    'top_transfer_sources', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (
      SELECT source_competency_id, targets_affected, avg_transfer_score, total_sample_size
      FROM public.v_competency_transfer_effects LIMIT 10) t), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_skill_graph_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_skill_graph_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_recompute_skill_graph()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN public.fn_recompute_kg_competency_nodes();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_recompute_skill_graph() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recompute_skill_graph() TO authenticated;
