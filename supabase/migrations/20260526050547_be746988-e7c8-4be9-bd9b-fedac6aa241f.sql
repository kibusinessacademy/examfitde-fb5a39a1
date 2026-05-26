
-- 1) Extend node_type enum
DO $$ BEGIN
  ALTER TYPE berufs_ki_graph_node_type ADD VALUE IF NOT EXISTS 'skill';
  ALTER TYPE berufs_ki_graph_node_type ADD VALUE IF NOT EXISTS 'outcome';
  ALTER TYPE berufs_ki_graph_node_type ADD VALUE IF NOT EXISTS 'recovery_action';
  ALTER TYPE berufs_ki_graph_node_type ADD VALUE IF NOT EXISTS 'lesson';
  ALTER TYPE berufs_ki_graph_node_type ADD VALUE IF NOT EXISTS 'certification';
  ALTER TYPE berufs_ki_graph_node_type ADD VALUE IF NOT EXISTS 'curriculum';
END $$;

-- 2) Extend edge_type enum
DO $$ BEGIN
  ALTER TYPE berufs_ki_graph_edge_type ADD VALUE IF NOT EXISTS 'trains';
  ALTER TYPE berufs_ki_graph_edge_type ADD VALUE IF NOT EXISTS 'assesses';
  ALTER TYPE berufs_ki_graph_edge_type ADD VALUE IF NOT EXISTS 'recovers';
  ALTER TYPE berufs_ki_graph_edge_type ADD VALUE IF NOT EXISTS 'produces';
  ALTER TYPE berufs_ki_graph_edge_type ADD VALUE IF NOT EXISTS 'prerequisite_of';
  ALTER TYPE berufs_ki_graph_edge_type ADD VALUE IF NOT EXISTS 'weakens';
  ALTER TYPE berufs_ki_graph_edge_type ADD VALUE IF NOT EXISTS 'strengthens';
END $$;

-- 3) Lifecycle status types
DO $$ BEGIN
  CREATE TYPE berufs_ki_graph_node_status AS ENUM ('draft','active','deprecated','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE berufs_ki_graph_edge_status AS ENUM ('proposed','active','rejected','deprecated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4) Extend nodes
ALTER TABLE public.berufs_ki_graph_nodes
  ADD COLUMN IF NOT EXISTS status berufs_ki_graph_node_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS confidence_score numeric(4,3) NOT NULL DEFAULT 1.000;

CREATE INDEX IF NOT EXISTS idx_bki_graph_nodes_status ON public.berufs_ki_graph_nodes(status);
CREATE INDEX IF NOT EXISTS idx_bki_graph_nodes_slug   ON public.berufs_ki_graph_nodes(slug) WHERE slug IS NOT NULL;

-- 5) Extend edges
ALTER TABLE public.berufs_ki_graph_edges
  ADD COLUMN IF NOT EXISTS status berufs_ki_graph_edge_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS weight numeric(6,3) NOT NULL DEFAULT 1.000,
  ADD COLUMN IF NOT EXISTS evidence_source text,
  ADD COLUMN IF NOT EXISTS evidence_ref text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_bki_graph_edges_status ON public.berufs_ki_graph_edges(status);

-- 6) Evidence table
CREATE TABLE IF NOT EXISTS public.berufs_ki_graph_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_id uuid NOT NULL REFERENCES public.berufs_ki_graph_edges(id) ON DELETE CASCADE,
  evidence_type text NOT NULL CHECK (evidence_type IN (
    'curriculum','blueprint','exam_result','workflow_outcome',
    'recovery_result','tutor_context','manual_admin','deterministic_builder'
  )),
  source_table text,
  source_id uuid,
  confidence numeric(4,3) NOT NULL DEFAULT 1.000 CHECK (confidence BETWEEN 0 AND 1),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bki_graph_evidence_edge ON public.berufs_ki_graph_evidence(edge_id);
CREATE INDEX IF NOT EXISTS idx_bki_graph_evidence_type ON public.berufs_ki_graph_evidence(evidence_type);

ALTER TABLE public.berufs_ki_graph_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bki_graph_evidence_admin_all ON public.berufs_ki_graph_evidence;
CREATE POLICY bki_graph_evidence_admin_all ON public.berufs_ki_graph_evidence
  TO authenticated USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS bki_graph_evidence_read ON public.berufs_ki_graph_evidence;
CREATE POLICY bki_graph_evidence_read ON public.berufs_ki_graph_evidence
  FOR SELECT TO authenticated USING (true);

-- 7) Snapshots table
CREATE TABLE IF NOT EXISTS public.berufs_ki_graph_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_scope text NOT NULL DEFAULT 'global',
  node_count integer NOT NULL,
  edge_count integer NOT NULL,
  checksum text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid
);
CREATE INDEX IF NOT EXISTS idx_bki_graph_snapshots_scope ON public.berufs_ki_graph_snapshots(graph_scope, generated_at DESC);

ALTER TABLE public.berufs_ki_graph_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bki_graph_snapshots_admin_all ON public.berufs_ki_graph_snapshots;
CREATE POLICY bki_graph_snapshots_admin_all ON public.berufs_ki_graph_snapshots
  TO authenticated USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- 8) Helper views
CREATE OR REPLACE VIEW public.v_bki_graph_orphan_nodes AS
SELECT n.id, n.node_type, n.title, n.status, n.created_at
FROM public.berufs_ki_graph_nodes n
LEFT JOIN public.berufs_ki_graph_edges e
  ON e.from_node_id = n.id OR e.to_node_id = n.id
WHERE e.id IS NULL AND n.status = 'active';

CREATE OR REPLACE VIEW public.v_bki_graph_proposed_edges AS
SELECT e.id, e.edge_type, e.confidence_score, e.source, e.created_at,
  fn.node_type AS from_type, fn.title AS from_title,
  tn.node_type AS to_type,   tn.title AS to_title,
  (SELECT count(*) FROM public.berufs_ki_graph_evidence ev WHERE ev.edge_id = e.id) AS evidence_count
FROM public.berufs_ki_graph_edges e
JOIN public.berufs_ki_graph_nodes fn ON fn.id = e.from_node_id
JOIN public.berufs_ki_graph_nodes tn ON tn.id = e.to_node_id
WHERE e.status = 'proposed'
ORDER BY e.created_at DESC;

REVOKE ALL ON public.v_bki_graph_orphan_nodes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_bki_graph_proposed_edges FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_bki_graph_orphan_nodes TO service_role;
GRANT SELECT ON public.v_bki_graph_proposed_edges TO service_role;

-- 10) Summary RPC
CREATE OR REPLACE FUNCTION public.admin_get_berufos_graph_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'owner'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT jsonb_build_object(
    'totals', (SELECT row_to_json(s) FROM v_bki_graph_summary s),
    'nodes_by_type', (SELECT jsonb_object_agg(node_type::text, c) FROM (SELECT node_type, count(*) c FROM berufs_ki_graph_nodes WHERE status='active' GROUP BY 1) t),
    'nodes_by_status', (SELECT jsonb_object_agg(status::text, c) FROM (SELECT status, count(*) c FROM berufs_ki_graph_nodes GROUP BY 1) t),
    'edges_by_type', (SELECT jsonb_object_agg(edge_type::text, c) FROM (SELECT edge_type, count(*) c FROM berufs_ki_graph_edges WHERE status='active' GROUP BY 1) t),
    'edges_by_status', (SELECT jsonb_object_agg(status::text, c) FROM (SELECT status, count(*) c FROM berufs_ki_graph_edges GROUP BY 1) t),
    'orphan_count', (SELECT count(*) FROM v_bki_graph_orphan_nodes),
    'proposed_count', (SELECT count(*) FROM v_bki_graph_proposed_edges),
    'evidence_count', (SELECT count(*) FROM berufs_ki_graph_evidence),
    'latest_snapshot', (SELECT row_to_json(s) FROM (SELECT id, graph_scope, node_count, edge_count, checksum, generated_at FROM berufs_ki_graph_snapshots ORDER BY generated_at DESC LIMIT 1) s)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_get_berufos_graph_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_berufos_graph_summary() TO authenticated;

-- 11) Drift report RPC
CREATE OR REPLACE FUNCTION public.admin_get_berufos_graph_drift_report()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'owner'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT jsonb_build_object(
    'edges_without_evidence', (SELECT count(*) FROM berufs_ki_graph_edges e WHERE e.status='active' AND NOT EXISTS (SELECT 1 FROM berufs_ki_graph_evidence ev WHERE ev.edge_id = e.id)),
    'orphan_active_nodes', (SELECT count(*) FROM v_bki_graph_orphan_nodes),
    'proposed_stale_7d', (SELECT count(*) FROM berufs_ki_graph_edges WHERE status='proposed' AND created_at < now() - interval '7 days'),
    'deprecated_with_active_edges', (SELECT count(DISTINCT n.id) FROM berufs_ki_graph_nodes n JOIN berufs_ki_graph_edges e ON (e.from_node_id=n.id OR e.to_node_id=n.id) AND e.status='active' WHERE n.status IN ('deprecated','archived')),
    'low_confidence_active_edges', (SELECT count(*) FROM berufs_ki_graph_edges WHERE status='active' AND confidence_score < 0.5)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_get_berufos_graph_drift_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_berufos_graph_drift_report() TO authenticated;

-- 12) Node detail
CREATE OR REPLACE FUNCTION public.admin_get_berufos_graph_node_detail(p_node_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'owner'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT jsonb_build_object(
    'node', to_jsonb(n.*),
    'incoming_edges', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'edge_type', e.edge_type, 'status', e.status, 'confidence', e.confidence_score, 'from_id', e.from_node_id, 'from_title', fn.title, 'from_type', fn.node_type)) FROM berufs_ki_graph_edges e JOIN berufs_ki_graph_nodes fn ON fn.id=e.from_node_id WHERE e.to_node_id = p_node_id), '[]'::jsonb),
    'outgoing_edges', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'edge_type', e.edge_type, 'status', e.status, 'confidence', e.confidence_score, 'to_id', e.to_node_id, 'to_title', tn.title, 'to_type', tn.node_type)) FROM berufs_ki_graph_edges e JOIN berufs_ki_graph_nodes tn ON tn.id=e.to_node_id WHERE e.from_node_id = p_node_id), '[]'::jsonb)
  ) INTO result FROM berufs_ki_graph_nodes n WHERE n.id = p_node_id;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_get_berufos_graph_node_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_berufos_graph_node_detail(uuid) TO authenticated;

-- 13) Activate / reject proposed edge
CREATE OR REPLACE FUNCTION public.admin_activate_proposed_edge(p_edge_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_evidence_count int; v_uid uuid;
BEGIN
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'owner'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_uid := auth.uid();
  SELECT count(*) INTO v_evidence_count FROM berufs_ki_graph_evidence WHERE edge_id = p_edge_id;
  IF v_evidence_count = 0 THEN RAISE EXCEPTION 'edge_has_no_evidence: edge_id=%', p_edge_id; END IF;
  UPDATE berufs_ki_graph_edges SET status='active', updated_at=now() WHERE id=p_edge_id AND status='proposed';
  IF NOT FOUND THEN RAISE EXCEPTION 'edge_not_proposed_or_missing: %', p_edge_id; END IF;
  PERFORM public.fn_emit_audit('berufos_graph_edge_activated','graph_edge', p_edge_id::text, 'success',
    jsonb_build_object('actor_uid', v_uid, 'reason', p_reason, 'evidence_count', v_evidence_count));
  RETURN jsonb_build_object('ok', true, 'edge_id', p_edge_id);
END $$;
REVOKE ALL ON FUNCTION public.admin_activate_proposed_edge(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_activate_proposed_edge(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reject_proposed_edge(p_edge_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'owner'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_uid := auth.uid();
  UPDATE berufs_ki_graph_edges SET status='rejected', updated_at=now() WHERE id=p_edge_id AND status='proposed';
  IF NOT FOUND THEN RAISE EXCEPTION 'edge_not_proposed_or_missing: %', p_edge_id; END IF;
  PERFORM public.fn_emit_audit('berufos_graph_edge_rejected','graph_edge', p_edge_id::text, 'success',
    jsonb_build_object('actor_uid', v_uid, 'reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'edge_id', p_edge_id);
END $$;
REVOKE ALL ON FUNCTION public.admin_reject_proposed_edge(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_proposed_edge(uuid, text) TO authenticated;

-- 14) Deterministic rebuild + snapshot
CREATE OR REPLACE FUNCTION public.admin_rebuild_berufos_graph(p_scope text DEFAULT 'global', p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
  v_node_count int;
  v_edge_count int;
  v_checksum text;
  v_snap_id uuid;
  v_curr_inserted int := 0;
  v_cert_inserted int := 0;
  v_comp_inserted int := 0;
  v_belongs_inserted int := 0;
BEGIN
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'owner'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_uid := auth.uid();

  PERFORM public.fn_emit_audit('berufos_graph_rebuild_started','graph', p_scope, 'success',
    jsonb_build_object('actor_uid', v_uid, 'dry_run', p_dry_run, 'scope', p_scope));

  IF NOT p_dry_run THEN
    WITH ins AS (
      INSERT INTO berufs_ki_graph_nodes (node_type, source_system, source_ref_id, title, description, slug, status, confidence_score)
      SELECT 'curriculum'::berufs_ki_graph_node_type, 'curricula', c.id, c.title,
             COALESCE(c.description, c.title), c.slug, 'active', 1.000
      FROM public.curricula c
      ON CONFLICT (node_type, source_system, source_ref_id) DO NOTHING
      RETURNING 1
    ) SELECT count(*) INTO v_curr_inserted FROM ins;

    BEGIN
      WITH ins AS (
        INSERT INTO berufs_ki_graph_nodes (node_type, source_system, source_ref_id, title, slug, status, confidence_score)
        SELECT 'certification'::berufs_ki_graph_node_type, 'certification_catalog', cc.id, cc.title, cc.slug, 'active', 1.000
        FROM public.certification_catalog cc
        ON CONFLICT (node_type, source_system, source_ref_id) DO NOTHING
        RETURNING 1
      ) SELECT count(*) INTO v_cert_inserted FROM ins;
    EXCEPTION WHEN undefined_table OR undefined_column THEN v_cert_inserted := 0; END;

    BEGIN
      WITH ins AS (
        INSERT INTO berufs_ki_graph_nodes (node_type, source_system, source_ref_id, title, description, status, confidence_score)
        SELECT 'competency'::berufs_ki_graph_node_type, 'competencies', co.id,
               COALESCE(co.title, 'Kompetenz'), co.description, 'active', 1.000
        FROM public.competencies co
        ON CONFLICT (node_type, source_system, source_ref_id) DO NOTHING
        RETURNING 1
      ) SELECT count(*) INTO v_comp_inserted FROM ins;
    EXCEPTION WHEN undefined_table OR undefined_column THEN v_comp_inserted := 0; END;

    BEGIN
      WITH ins AS (
        INSERT INTO berufs_ki_graph_edges (from_node_id, to_node_id, edge_type, status, confidence_score, source, weight, evidence_source)
        SELECT comp_node.id, curr_node.id, 'belongs_to'::berufs_ki_graph_edge_type,
               'active', 1.000, 'deterministic_builder', 1.000, 'competencies.curriculum_id'
        FROM public.competencies co
        JOIN berufs_ki_graph_nodes comp_node
          ON comp_node.node_type='competency' AND comp_node.source_system='competencies' AND comp_node.source_ref_id=co.id
        JOIN berufs_ki_graph_nodes curr_node
          ON curr_node.node_type='curriculum' AND curr_node.source_system='curricula' AND curr_node.source_ref_id=co.curriculum_id
        WHERE co.curriculum_id IS NOT NULL
        ON CONFLICT (from_node_id, to_node_id, edge_type) DO NOTHING
        RETURNING id
      ),
      ev AS (
        INSERT INTO berufs_ki_graph_evidence (edge_id, evidence_type, source_table, confidence, metadata)
        SELECT i.id, 'deterministic_builder', 'competencies', 1.000, jsonb_build_object('rule','belongs_to_curriculum')
        FROM ins i
        RETURNING 1
      )
      SELECT count(*) INTO v_belongs_inserted FROM ev;
    EXCEPTION WHEN undefined_column OR undefined_table THEN v_belongs_inserted := 0; END;
  END IF;

  SELECT count(*) INTO v_node_count FROM berufs_ki_graph_nodes WHERE status='active';
  SELECT count(*) INTO v_edge_count FROM berufs_ki_graph_edges WHERE status='active';

  SELECT md5(
    COALESCE((SELECT string_agg(id::text, ',' ORDER BY id) FROM berufs_ki_graph_nodes WHERE status='active'), '') ||
    '|' ||
    COALESCE((SELECT string_agg(from_node_id::text||'>'||to_node_id::text||'>'||edge_type::text, ',' ORDER BY from_node_id, to_node_id, edge_type) FROM berufs_ki_graph_edges WHERE status='active'), '')
  ) INTO v_checksum;

  IF NOT p_dry_run THEN
    INSERT INTO berufs_ki_graph_snapshots (graph_scope, node_count, edge_count, checksum, generated_by, meta)
    VALUES (p_scope, v_node_count, v_edge_count, v_checksum, v_uid,
      jsonb_build_object(
        'curricula_inserted', v_curr_inserted,
        'certifications_inserted', v_cert_inserted,
        'competencies_inserted', v_comp_inserted,
        'belongs_to_edges_inserted', v_belongs_inserted
      ))
    RETURNING id INTO v_snap_id;
  END IF;

  PERFORM public.fn_emit_audit('berufos_graph_rebuild_completed','graph', p_scope, 'success',
    jsonb_build_object('actor_uid', v_uid, 'dry_run', p_dry_run, 'node_count', v_node_count,
      'edge_count', v_edge_count, 'checksum', v_checksum, 'snapshot_id', v_snap_id,
      'curricula_inserted', v_curr_inserted, 'certifications_inserted', v_cert_inserted,
      'competencies_inserted', v_comp_inserted, 'belongs_to_edges_inserted', v_belongs_inserted));

  RETURN jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'scope', p_scope,
    'node_count', v_node_count, 'edge_count', v_edge_count, 'checksum', v_checksum,
    'snapshot_id', v_snap_id,
    'inserted', jsonb_build_object('curricula', v_curr_inserted, 'certifications', v_cert_inserted,
      'competencies', v_comp_inserted, 'belongs_to_edges', v_belongs_inserted));
END $$;
REVOKE ALL ON FUNCTION public.admin_rebuild_berufos_graph(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rebuild_berufos_graph(text, boolean) TO authenticated;

-- 15) Learner skill path
CREATE OR REPLACE FUNCTION public.learner_get_skill_path()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  RETURN jsonb_build_object('user_id', v_uid,
    'skills', COALESCE((SELECT jsonb_agg(jsonb_build_object('node_id', n.id, 'title', n.title, 'status', n.status, 'confidence', n.confidence_score)) FROM berufs_ki_graph_nodes n WHERE n.node_type='skill' AND n.status='active' LIMIT 50), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.learner_get_skill_path() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_get_skill_path() TO authenticated;

-- 16) Manager competency risk graph
CREATE OR REPLACE FUNCTION public.manager_get_competency_risk_graph()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF NOT (has_role(v_uid,'admin'::app_role) OR has_role(v_uid,'owner'::app_role) OR has_role(v_uid,'manager'::app_role)) THEN
    RAISE EXCEPTION 'forbidden_no_manager_role';
  END IF;
  RETURN jsonb_build_object('competencies', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('node_id', n.id, 'title', n.title,
      'incoming_edges', (SELECT count(*) FROM berufs_ki_graph_edges e WHERE e.to_node_id=n.id AND e.status='active'),
      'outgoing_edges', (SELECT count(*) FROM berufs_ki_graph_edges e WHERE e.from_node_id=n.id AND e.status='active')
    )) FROM berufs_ki_graph_nodes n WHERE n.node_type='competency' AND n.status='active' LIMIT 200
  ), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.manager_get_competency_risk_graph() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_get_competency_risk_graph() TO authenticated;

-- 17) Audit contracts (correct schema: required_keys text[], owner_module)
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module) VALUES
  ('berufos_graph_rebuild_started',  ARRAY['actor_uid','dry_run','scope'], 'berufos_graph'),
  ('berufos_graph_rebuild_completed',ARRAY['actor_uid','dry_run','node_count','edge_count','checksum'], 'berufos_graph'),
  ('berufos_graph_drift_detected',   ARRAY['scope','drift_kind','count'], 'berufos_graph'),
  ('berufos_graph_edge_proposed',    ARRAY['edge_id','edge_type','source'], 'berufos_graph'),
  ('berufos_graph_edge_activated',   ARRAY['actor_uid','evidence_count'], 'berufos_graph'),
  ('berufos_graph_edge_rejected',    ARRAY['actor_uid'], 'berufos_graph'),
  ('berufos_graph_integrity_failed', ARRAY['scope','reason'], 'berufos_graph')
ON CONFLICT (action_type) DO NOTHING;
