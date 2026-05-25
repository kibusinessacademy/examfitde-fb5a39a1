-- Phase 5F: Berufs-KI Knowledge Graph
-- Phase 5D: Workflow Evolution Engine
-- Phase 5G: Graph Analytics

CREATE TYPE public.berufs_ki_graph_node_type AS ENUM (
  'workflow', 'competency', 'blueprint', 'learning_field',
  'profession', 'role', 'industry', 'problem_type',
  'document_type', 'risk', 'kpi', 'sop', 'ticket',
  'ai_agent', 'workflow_chain'
);

CREATE TYPE public.berufs_ki_graph_edge_type AS ENUM (
  'related_to', 'requires', 'improves', 'causes',
  'derived_from', 'commonly_used_with', 'maps_to',
  'belongs_to', 'extends', 'conflicts_with',
  'part_of', 'supports'
);

CREATE TYPE public.berufs_ki_evolution_status AS ENUM (
  'detected', 'under_review', 'approved', 'rejected', 'applied'
);

-- ===== Phase 5F: Graph Nodes =====
CREATE TABLE public.berufs_ki_graph_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_type public.berufs_ki_graph_node_type NOT NULL,
  title text NOT NULL,
  description text,
  profession_id uuid,
  source_system text NOT NULL DEFAULT 'manual',
  source_ref_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_type, source_system, source_ref_id)
);

CREATE INDEX idx_bki_graph_nodes_type ON public.berufs_ki_graph_nodes(node_type);
CREATE INDEX idx_bki_graph_nodes_profession ON public.berufs_ki_graph_nodes(profession_id);
CREATE INDEX idx_bki_graph_nodes_source_ref ON public.berufs_ki_graph_nodes(source_system, source_ref_id);

ALTER TABLE public.berufs_ki_graph_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "graph_nodes_admin_all" ON public.berufs_ki_graph_nodes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "graph_nodes_authenticated_read" ON public.berufs_ki_graph_nodes
  FOR SELECT TO authenticated USING (true);

-- ===== Phase 5F: Graph Edges =====
CREATE TABLE public.berufs_ki_graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_id uuid NOT NULL REFERENCES public.berufs_ki_graph_nodes(id) ON DELETE CASCADE,
  to_node_id uuid NOT NULL REFERENCES public.berufs_ki_graph_nodes(id) ON DELETE CASCADE,
  edge_type public.berufs_ki_graph_edge_type NOT NULL,
  confidence_score numeric(4,3) NOT NULL DEFAULT 1.000 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  source text NOT NULL DEFAULT 'manual',
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_node_id <> to_node_id),
  UNIQUE (from_node_id, to_node_id, edge_type)
);

CREATE INDEX idx_bki_graph_edges_from ON public.berufs_ki_graph_edges(from_node_id);
CREATE INDEX idx_bki_graph_edges_to ON public.berufs_ki_graph_edges(to_node_id);
CREATE INDEX idx_bki_graph_edges_type ON public.berufs_ki_graph_edges(edge_type);

ALTER TABLE public.berufs_ki_graph_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "graph_edges_admin_all" ON public.berufs_ki_graph_edges
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "graph_edges_authenticated_read" ON public.berufs_ki_graph_edges
  FOR SELECT TO authenticated USING (true);

-- ===== Phase 5D: Evolution Candidates =====
CREATE TABLE public.berufs_ki_evolution_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_workflow_ids uuid[] NOT NULL DEFAULT '{}',
  detected_pattern text NOT NULL,
  pattern_type text NOT NULL DEFAULT 'output_structure',
  suggested_improvements jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality_delta numeric(5,2),
  confidence_score numeric(4,3) NOT NULL DEFAULT 0.500,
  governance_risk text NOT NULL DEFAULT 'low' CHECK (governance_risk IN ('low','medium','high')),
  suggested_merge boolean NOT NULL DEFAULT false,
  suggested_blueprint_update jsonb,
  status public.berufs_ki_evolution_status NOT NULL DEFAULT 'detected',
  reviewed_by uuid,
  reviewed_at timestamptz,
  applied_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bki_evo_status ON public.berufs_ki_evolution_candidates(status);
CREATE INDEX idx_bki_evo_pattern ON public.berufs_ki_evolution_candidates(pattern_type);

ALTER TABLE public.berufs_ki_evolution_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "evo_candidates_admin_all" ON public.berufs_ki_evolution_candidates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ===== updated_at trigger =====
CREATE TRIGGER trg_bki_graph_nodes_updated
  BEFORE UPDATE ON public.berufs_ki_graph_nodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_bki_evo_updated
  BEFORE UPDATE ON public.berufs_ki_evolution_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== Phase 5F: Sync existing workflows into graph =====
CREATE OR REPLACE FUNCTION public.bki_sync_workflow_node()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.berufs_ki_graph_nodes (node_type, title, description, source_system, source_ref_id, metadata)
  VALUES ('workflow', NEW.title, NEW.description, 'workflow_definition', NEW.id,
          jsonb_build_object('slug', NEW.slug, 'category', NEW.category, 'tier_required', NEW.tier_required, 'workflow_class', NEW.workflow_class))
  ON CONFLICT (node_type, source_system, source_ref_id) DO UPDATE
    SET title = EXCLUDED.title, description = EXCLUDED.description, metadata = EXCLUDED.metadata, updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bki_sync_workflow_node
  AFTER INSERT OR UPDATE ON public.berufs_ki_workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION public.bki_sync_workflow_node();

-- Backfill workflow nodes
INSERT INTO public.berufs_ki_graph_nodes (node_type, title, description, source_system, source_ref_id, metadata)
SELECT 'workflow', title, description, 'workflow_definition', id,
       jsonb_build_object('slug', slug, 'category', category, 'tier_required', tier_required, 'workflow_class', workflow_class)
FROM public.berufs_ki_workflow_definitions
ON CONFLICT (node_type, source_system, source_ref_id) DO NOTHING;

-- ===== Phase 5G: Analytics Views =====
CREATE OR REPLACE VIEW public.v_bki_graph_summary AS
SELECT
  (SELECT count(*) FROM public.berufs_ki_graph_nodes) AS total_nodes,
  (SELECT count(*) FROM public.berufs_ki_graph_edges) AS total_edges,
  (SELECT count(DISTINCT node_type) FROM public.berufs_ki_graph_nodes) AS distinct_node_types,
  (SELECT count(DISTINCT edge_type) FROM public.berufs_ki_graph_edges) AS distinct_edge_types,
  (SELECT count(*) FROM public.berufs_ki_evolution_candidates WHERE status = 'detected') AS pending_evolution_candidates;

REVOKE ALL ON public.v_bki_graph_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_bki_graph_summary TO service_role;

-- ===== Admin RPCs =====
CREATE OR REPLACE FUNCTION public.admin_bki_graph_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  SELECT jsonb_build_object(
    'totals', (SELECT row_to_json(s) FROM public.v_bki_graph_summary s),
    'nodes_by_type', (
      SELECT COALESCE(jsonb_object_agg(node_type, cnt), '{}'::jsonb)
      FROM (SELECT node_type::text, count(*) AS cnt FROM public.berufs_ki_graph_nodes GROUP BY node_type) t
    ),
    'edges_by_type', (
      SELECT COALESCE(jsonb_object_agg(edge_type, cnt), '{}'::jsonb)
      FROM (SELECT edge_type::text, count(*) AS cnt FROM public.berufs_ki_graph_edges GROUP BY edge_type) t
    ),
    'top_hubs', (
      SELECT COALESCE(jsonb_agg(row_to_json(h)), '[]'::jsonb) FROM (
        SELECT n.id, n.title, n.node_type::text,
               (SELECT count(*) FROM public.berufs_ki_graph_edges e
                WHERE e.from_node_id = n.id OR e.to_node_id = n.id) AS degree
        FROM public.berufs_ki_graph_nodes n
        ORDER BY degree DESC NULLS LAST
        LIMIT 10
      ) h
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_bki_create_node(
  _node_type public.berufs_ki_graph_node_type,
  _title text,
  _description text DEFAULT NULL,
  _profession_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF _title IS NULL OR length(trim(_title)) = 0 THEN
    RAISE EXCEPTION 'title required';
  END IF;
  INSERT INTO public.berufs_ki_graph_nodes (node_type, title, description, profession_id, source_system, metadata)
  VALUES (_node_type, _title, _description, _profession_id, 'manual', COALESCE(_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_bki_create_edge(
  _from uuid,
  _to uuid,
  _edge_type public.berufs_ki_graph_edge_type,
  _confidence numeric DEFAULT 1.0,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF _from = _to THEN
    RAISE EXCEPTION 'self-loop not allowed';
  END IF;
  INSERT INTO public.berufs_ki_graph_edges (from_node_id, to_node_id, edge_type, confidence_score, source, created_by, metadata)
  VALUES (_from, _to, _edge_type, COALESCE(_confidence, 1.0), 'manual', auth.uid(), COALESCE(_metadata, '{}'::jsonb))
  ON CONFLICT (from_node_id, to_node_id, edge_type) DO UPDATE
    SET confidence_score = EXCLUDED.confidence_score, metadata = EXCLUDED.metadata
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_bki_delete_edge(_edge_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  DELETE FROM public.berufs_ki_graph_edges WHERE id = _edge_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_bki_neighborhood(_node_id uuid, _depth int DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_nodes jsonb;
  v_edges jsonb;
  v_depth int := GREATEST(1, LEAST(COALESCE(_depth, 1), 3));
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  WITH RECURSIVE walk AS (
    SELECT _node_id AS node_id, 0 AS d
    UNION
    SELECT CASE WHEN e.from_node_id = w.node_id THEN e.to_node_id ELSE e.from_node_id END, w.d + 1
    FROM walk w
    JOIN public.berufs_ki_graph_edges e
      ON (e.from_node_id = w.node_id OR e.to_node_id = w.node_id)
    WHERE w.d < v_depth
  )
  SELECT
    (SELECT jsonb_agg(row_to_json(n)) FROM public.berufs_ki_graph_nodes n WHERE n.id IN (SELECT node_id FROM walk)),
    (SELECT jsonb_agg(row_to_json(e))
     FROM public.berufs_ki_graph_edges e
     WHERE e.from_node_id IN (SELECT node_id FROM walk)
       AND e.to_node_id IN (SELECT node_id FROM walk))
  INTO v_nodes, v_edges;

  RETURN jsonb_build_object('nodes', COALESCE(v_nodes, '[]'::jsonb), 'edges', COALESCE(v_edges, '[]'::jsonb));
END;
$$;

-- ===== Phase 5D: Evolution RPCs =====
CREATE OR REPLACE FUNCTION public.admin_bki_evolution_detect()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inserted int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  -- Pattern 1: workflows mit hoher avg-Quality (>= 4) und >= 3 runs => suggest blueprint promotion
  INSERT INTO public.berufs_ki_evolution_candidates
    (source_workflow_ids, detected_pattern, pattern_type, suggested_improvements, quality_delta, confidence_score, governance_risk, metadata)
  SELECT
    ARRAY[wd.id],
    'High-quality workflow pattern: ' || wd.title,
    'high_quality_promotion',
    jsonb_build_object('action', 'consider_blueprint_promotion', 'workflow_id', wd.id, 'workflow_slug', wd.slug),
    ROUND(AVG(wr.quality_score)::numeric, 2),
    LEAST(0.95, 0.5 + (count(wr.id) * 0.05))::numeric(4,3),
    'low',
    jsonb_build_object('run_count', count(wr.id), 'avg_rating', AVG(wr.user_rating))
  FROM public.berufs_ki_workflow_definitions wd
  JOIN public.berufs_ki_workflow_runs wr ON wr.workflow_id = wd.id
  WHERE wr.quality_score IS NOT NULL
    AND wd.workflow_class IN ('official','community_verified')
  GROUP BY wd.id, wd.title, wd.slug
  HAVING AVG(wr.quality_score) >= 4 AND count(wr.id) >= 3
    AND NOT EXISTS (
      SELECT 1 FROM public.berufs_ki_evolution_candidates ec
      WHERE ec.pattern_type = 'high_quality_promotion'
        AND wd.id = ANY(ec.source_workflow_ids)
        AND ec.status IN ('detected','under_review','approved')
    );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('inserted', v_inserted, 'detected_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_bki_evolution_decide(
  _candidate_id uuid,
  _decision text,
  _notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status public.berufs_ki_evolution_status;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF _decision NOT IN ('approve','reject','review') THEN
    RAISE EXCEPTION 'invalid decision: %', _decision;
  END IF;
  v_status := CASE _decision
    WHEN 'approve' THEN 'approved'::public.berufs_ki_evolution_status
    WHEN 'reject'  THEN 'rejected'::public.berufs_ki_evolution_status
    ELSE 'under_review'::public.berufs_ki_evolution_status
  END;

  UPDATE public.berufs_ki_evolution_candidates
  SET status = v_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      metadata = metadata || jsonb_build_object('reviewer_notes', _notes)
  WHERE id = _candidate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate not found';
  END IF;

  RETURN jsonb_build_object('id', _candidate_id, 'status', v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_bki_evolution_list(_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM public.berufs_ki_evolution_candidates c
  WHERE _status IS NULL OR c.status::text = _status;
  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_bki_graph_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bki_create_node(public.berufs_ki_graph_node_type, text, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bki_create_edge(uuid, uuid, public.berufs_ki_graph_edge_type, numeric, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bki_delete_edge(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bki_neighborhood(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bki_evolution_detect() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bki_evolution_decide(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bki_evolution_list(text) TO authenticated;