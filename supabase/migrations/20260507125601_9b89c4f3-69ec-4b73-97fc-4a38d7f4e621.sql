-- =====================================================================
-- Growth OS Phase 2B: Content Graph SSOT
-- Scope: tables + RPCs + orphan view. No backfill, no UI.
-- =====================================================================

-- ---------- Enums ----------
DO $$ BEGIN
  CREATE TYPE public.growth_node_status AS ENUM ('draft','active','deprecated','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.growth_edge_type AS ENUM (
    'internal_link','funnel_next','money_page','related','canonical_parent'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Nodes ----------
CREATE TABLE IF NOT EXISTS public.growth_content_graph_nodes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_slug           text NOT NULL,
  title               text NOT NULL,
  asset_type          text NOT NULL,                -- blog | landing | product | lead_magnet | faq | llm_asset | hub
  persona             text,                         -- azubi | betrieb | trainer | unknown
  funnel_stage        text,                         -- tofu | mofu | bofu | retention
  cluster_id          uuid,
  keyword_slug        text,
  owner_kind          text NOT NULL,                -- blog | seo_page | product_page | lead_magnet | hub
  owner_id            uuid,
  canonical_url       text,
  next_action_node_id uuid REFERENCES public.growth_content_graph_nodes(id) ON DELETE SET NULL,
  status              public.growth_node_status NOT NULL DEFAULT 'draft',
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  CONSTRAINT growth_nodes_asset_type_chk CHECK (asset_type IN
    ('blog','landing','product','lead_magnet','faq','llm_asset','hub')),
  CONSTRAINT growth_nodes_owner_kind_chk CHECK (owner_kind IN
    ('blog','seo_page','product_page','lead_magnet','hub')),
  CONSTRAINT growth_nodes_funnel_stage_chk CHECK (funnel_stage IS NULL OR funnel_stage IN
    ('tofu','mofu','bofu','retention'))
);

CREATE UNIQUE INDEX IF NOT EXISTS growth_nodes_slug_active_uq
  ON public.growth_content_graph_nodes(node_slug)
  WHERE status IN ('draft','active');

CREATE INDEX IF NOT EXISTS growth_nodes_cluster_idx ON public.growth_content_graph_nodes(cluster_id);
CREATE INDEX IF NOT EXISTS growth_nodes_keyword_idx ON public.growth_content_graph_nodes(keyword_slug);
CREATE INDEX IF NOT EXISTS growth_nodes_owner_idx   ON public.growth_content_graph_nodes(owner_kind, owner_id);
CREATE INDEX IF NOT EXISTS growth_nodes_status_idx  ON public.growth_content_graph_nodes(status);

-- ---------- Edges ----------
CREATE TABLE IF NOT EXISTS public.growth_content_graph_edges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_id uuid NOT NULL REFERENCES public.growth_content_graph_nodes(id) ON DELETE CASCADE,
  to_node_id   uuid NOT NULL REFERENCES public.growth_content_graph_nodes(id) ON DELETE CASCADE,
  edge_type    public.growth_edge_type NOT NULL,
  anchor_text  text,
  priority     int NOT NULL DEFAULT 0,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  CONSTRAINT growth_edges_no_self CHECK (from_node_id <> to_node_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS growth_edges_unique
  ON public.growth_content_graph_edges(from_node_id, to_node_id, edge_type);
CREATE INDEX IF NOT EXISTS growth_edges_from_idx ON public.growth_content_graph_edges(from_node_id, edge_type);
CREATE INDEX IF NOT EXISTS growth_edges_to_idx   ON public.growth_content_graph_edges(to_node_id, edge_type);

-- ---------- Updated-at trigger ----------
CREATE OR REPLACE FUNCTION public.fn_growth_nodes_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_growth_nodes_touch ON public.growth_content_graph_nodes;
CREATE TRIGGER trg_growth_nodes_touch
BEFORE UPDATE ON public.growth_content_graph_nodes
FOR EACH ROW EXECUTE FUNCTION public.fn_growth_nodes_touch_updated_at();

-- ---------- RLS Lockdown ----------
ALTER TABLE public.growth_content_graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_content_graph_edges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.growth_content_graph_nodes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.growth_content_graph_edges FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.growth_content_graph_nodes TO service_role;
GRANT  ALL ON public.growth_content_graph_edges TO service_role;

-- Service-role-only policies; admins access exclusively via SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS "growth_nodes_service_only" ON public.growth_content_graph_nodes;
CREATE POLICY "growth_nodes_service_only" ON public.growth_content_graph_nodes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "growth_edges_service_only" ON public.growth_content_graph_edges;
CREATE POLICY "growth_edges_service_only" ON public.growth_content_graph_edges
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- RPCs (admin-gated, audited)
-- =====================================================================

-- Register a content node (insert or upsert by slug)
CREATE OR REPLACE FUNCTION public.admin_register_content_node(
  p_node_slug     text,
  p_title         text,
  p_asset_type    text,
  p_owner_kind    text,
  p_owner_id      uuid     DEFAULT NULL,
  p_persona       text     DEFAULT NULL,
  p_funnel_stage  text     DEFAULT NULL,
  p_cluster_id    uuid     DEFAULT NULL,
  p_keyword_slug  text     DEFAULT NULL,
  p_canonical_url text     DEFAULT NULL,
  p_metadata      jsonb    DEFAULT '{}'::jsonb,
  p_status        text     DEFAULT 'draft'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      uuid;
  v_action  text := 'inserted';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_node_slug IS NULL OR length(trim(p_node_slug)) = 0 THEN
    RAISE EXCEPTION 'node_slug required';
  END IF;

  SELECT id INTO v_id
  FROM public.growth_content_graph_nodes
  WHERE node_slug = p_node_slug
    AND status IN ('draft','active')
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.growth_content_graph_nodes
       SET title         = COALESCE(p_title, title),
           asset_type    = COALESCE(p_asset_type, asset_type),
           owner_kind    = COALESCE(p_owner_kind, owner_kind),
           owner_id      = COALESCE(p_owner_id, owner_id),
           persona       = COALESCE(p_persona, persona),
           funnel_stage  = COALESCE(p_funnel_stage, funnel_stage),
           cluster_id    = COALESCE(p_cluster_id, cluster_id),
           keyword_slug  = COALESCE(p_keyword_slug, keyword_slug),
           canonical_url = COALESCE(p_canonical_url, canonical_url),
           metadata      = COALESCE(metadata,'{}'::jsonb) || COALESCE(p_metadata,'{}'::jsonb),
           status        = COALESCE(p_status::public.growth_node_status, status)
     WHERE id = v_id;
    v_action := 'updated';
  ELSE
    INSERT INTO public.growth_content_graph_nodes(
      node_slug,title,asset_type,owner_kind,owner_id,persona,funnel_stage,
      cluster_id,keyword_slug,canonical_url,metadata,status,created_by
    ) VALUES (
      p_node_slug,p_title,p_asset_type,p_owner_kind,p_owner_id,p_persona,p_funnel_stage,
      p_cluster_id,p_keyword_slug,p_canonical_url,COALESCE(p_metadata,'{}'::jsonb),
      COALESCE(p_status::public.growth_node_status,'draft'::public.growth_node_status),
      auth.uid()
    )
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, details)
  VALUES (
    'growth_content_node_register', 'growth_content_node', v_id::text, 'success',
    jsonb_build_object('action', v_action, 'node_slug', p_node_slug, 'asset_type', p_asset_type)
  );

  RETURN jsonb_build_object('node_id', v_id, 'action', v_action);
END $$;

REVOKE ALL ON FUNCTION public.admin_register_content_node(text,text,text,text,uuid,text,text,uuid,text,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_register_content_node(text,text,text,text,uuid,text,text,uuid,text,text,jsonb,text) TO authenticated, service_role;

-- Link two nodes
CREATE OR REPLACE FUNCTION public.admin_link_content_nodes(
  p_from_node_id uuid,
  p_to_node_id   uuid,
  p_edge_type    text,
  p_anchor_text  text DEFAULT NULL,
  p_priority     int  DEFAULT 0,
  p_metadata     jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     uuid;
  v_action text := 'inserted';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_from_node_id = p_to_node_id THEN
    RAISE EXCEPTION 'self-loop not allowed';
  END IF;

  INSERT INTO public.growth_content_graph_edges(
    from_node_id,to_node_id,edge_type,anchor_text,priority,metadata,created_by
  ) VALUES (
    p_from_node_id,p_to_node_id,p_edge_type::public.growth_edge_type,
    p_anchor_text,COALESCE(p_priority,0),COALESCE(p_metadata,'{}'::jsonb),auth.uid()
  )
  ON CONFLICT (from_node_id,to_node_id,edge_type) DO UPDATE
    SET anchor_text = COALESCE(EXCLUDED.anchor_text, public.growth_content_graph_edges.anchor_text),
        priority    = EXCLUDED.priority,
        metadata    = public.growth_content_graph_edges.metadata || EXCLUDED.metadata
  RETURNING id INTO v_id;

  IF NOT FOUND THEN
    v_action := 'updated';
  END IF;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, details)
  VALUES (
    'growth_content_edge_link', 'growth_content_edge', v_id::text, 'success',
    jsonb_build_object('from', p_from_node_id, 'to', p_to_node_id, 'edge_type', p_edge_type, 'action', v_action)
  );

  RETURN jsonb_build_object('edge_id', v_id, 'action', v_action);
END $$;

REVOKE ALL ON FUNCTION public.admin_link_content_nodes(uuid,uuid,text,text,int,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_link_content_nodes(uuid,uuid,text,text,int,jsonb) TO authenticated, service_role;

-- Orphans: nodes missing inbound, outbound, funnel_next or money_page link
CREATE OR REPLACE FUNCTION public.admin_get_content_graph_orphans()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  WITH n AS (
    SELECT id, node_slug, title, asset_type, persona, funnel_stage, status
    FROM public.growth_content_graph_nodes
    WHERE status IN ('draft','active')
  ),
  out_e AS (
    SELECT from_node_id AS node_id, edge_type FROM public.growth_content_graph_edges
  ),
  in_e AS (
    SELECT to_node_id AS node_id FROM public.growth_content_graph_edges
  ),
  scored AS (
    SELECT n.*,
      NOT EXISTS (SELECT 1 FROM out_e o WHERE o.node_id = n.id) AS missing_outbound,
      NOT EXISTS (SELECT 1 FROM in_e  i WHERE i.node_id = n.id) AS missing_inbound,
      NOT EXISTS (SELECT 1 FROM out_e o WHERE o.node_id = n.id AND o.edge_type = 'funnel_next') AS missing_funnel_next,
      NOT EXISTS (SELECT 1 FROM out_e o WHERE o.node_id = n.id AND o.edge_type = 'money_page')   AS missing_money_page
    FROM n
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'total_nodes', (SELECT count(*) FROM n),
    'orphans', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.node_slug)
      FROM scored s
      WHERE s.missing_outbound OR s.missing_inbound OR s.missing_funnel_next OR s.missing_money_page
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_content_graph_orphans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_content_graph_orphans() TO authenticated, service_role;

-- Summary
CREATE OR REPLACE FUNCTION public.admin_get_content_graph_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'nodes_total',     (SELECT count(*) FROM public.growth_content_graph_nodes),
    'nodes_active',    (SELECT count(*) FROM public.growth_content_graph_nodes WHERE status='active'),
    'nodes_draft',     (SELECT count(*) FROM public.growth_content_graph_nodes WHERE status='draft'),
    'nodes_by_asset',  (SELECT COALESCE(jsonb_object_agg(asset_type, c),'{}'::jsonb) FROM (
                          SELECT asset_type, count(*) c FROM public.growth_content_graph_nodes GROUP BY asset_type
                        ) x),
    'edges_total',     (SELECT count(*) FROM public.growth_content_graph_edges),
    'edges_by_type',   (SELECT COALESCE(jsonb_object_agg(edge_type, c),'{}'::jsonb) FROM (
                          SELECT edge_type::text, count(*) c FROM public.growth_content_graph_edges GROUP BY edge_type
                        ) y)
  ) INTO v;

  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_content_graph_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_content_graph_summary() TO authenticated, service_role;
