-- Patch: admin_register_content_node — auto_heal_log.metadata statt details
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

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'growth_content_node_register', 'growth_content_node', v_id::text, 'success',
    jsonb_build_object('action', v_action, 'node_slug', p_node_slug, 'asset_type', p_asset_type)
  );

  RETURN jsonb_build_object('node_id', v_id, 'action', v_action);
END $$;

-- Patch: admin_link_content_nodes — Pre-Existence-Check für inserted/updated + metadata
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
  v_id           uuid;
  v_existing_id  uuid;
  v_action       text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_from_node_id = p_to_node_id THEN
    RAISE EXCEPTION 'self-loop not allowed';
  END IF;

  SELECT id INTO v_existing_id
  FROM public.growth_content_graph_edges
  WHERE from_node_id = p_from_node_id
    AND to_node_id   = p_to_node_id
    AND edge_type    = p_edge_type::public.growth_edge_type
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.growth_content_graph_edges
       SET anchor_text = COALESCE(p_anchor_text, anchor_text),
           priority    = COALESCE(p_priority, priority),
           metadata    = COALESCE(metadata,'{}'::jsonb) || COALESCE(p_metadata,'{}'::jsonb)
     WHERE id = v_existing_id;
    v_id     := v_existing_id;
    v_action := 'updated';
  ELSE
    INSERT INTO public.growth_content_graph_edges(
      from_node_id,to_node_id,edge_type,anchor_text,priority,metadata,created_by
    ) VALUES (
      p_from_node_id,p_to_node_id,p_edge_type::public.growth_edge_type,
      p_anchor_text,COALESCE(p_priority,0),COALESCE(p_metadata,'{}'::jsonb),auth.uid()
    )
    RETURNING id INTO v_id;
    v_action := 'inserted';
  END IF;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'growth_content_edge_link', 'growth_content_edge', v_id::text, 'success',
    jsonb_build_object('from', p_from_node_id, 'to', p_to_node_id, 'edge_type', p_edge_type, 'action', v_action)
  );

  RETURN jsonb_build_object('edge_id', v_id, 'action', v_action);
END $$;
