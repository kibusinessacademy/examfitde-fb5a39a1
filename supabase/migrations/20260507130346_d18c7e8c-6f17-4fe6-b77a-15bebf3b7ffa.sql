CREATE OR REPLACE FUNCTION public._smoke_growth_content_graph()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid     uuid := gen_random_uuid();
  v_prefix  text := '__smoke_p2b_' || substr(replace(v_uid::text,'-',''),1,8) || '_';
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_isolated uuid;
  v_r1 jsonb; v_r2 jsonb;
  v_e1 jsonb; v_e2 jsonb;
  v_orphans_root jsonb;
  v_orphans jsonb;
  v_failures jsonb := '[]'::jsonb;
  v_pass int := 0;
  v_fail int := 0;
  v_cond boolean;
BEGIN
  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'admin'::app_role);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text,
    true
  );

  -- T1 register inserted
  v_r1 := public.admin_register_content_node(v_prefix||'a','Smoke A','blog','blog');
  v_a  := (v_r1->>'node_id')::uuid;
  v_cond := v_r1->>'action' = 'inserted';
  IF v_cond THEN v_pass := v_pass+1;
  ELSE v_fail := v_fail+1; v_failures := v_failures || jsonb_build_array(jsonb_build_object('FAIL','T1_register_inserted','ctx',v_r1));
  END IF;

  -- T2 register updated (same slug)
  v_r2 := public.admin_register_content_node(v_prefix||'a','Smoke A v2','blog','blog');
  v_cond := v_r2->>'action' = 'updated';
  IF v_cond THEN v_pass := v_pass+1;
  ELSE v_fail := v_fail+1; v_failures := v_failures || jsonb_build_array(jsonb_build_object('FAIL','T2_register_updated','ctx',v_r2));
  END IF;

  v_b        := (public.admin_register_content_node(v_prefix||'b','B','blog','blog')->>'node_id')::uuid;
  v_c        := (public.admin_register_content_node(v_prefix||'c','C','product','product_page')->>'node_id')::uuid;
  v_d        := (public.admin_register_content_node(v_prefix||'d','D money','product','product_page')->>'node_id')::uuid;
  v_isolated := (public.admin_register_content_node(v_prefix||'iso','Isolated','blog','blog')->>'node_id')::uuid;

  -- T3 link inserted
  v_e1 := public.admin_link_content_nodes(v_a, v_b, 'internal_link');
  v_cond := v_e1->>'action' = 'inserted';
  IF v_cond THEN v_pass := v_pass+1;
  ELSE v_fail := v_fail+1; v_failures := v_failures || jsonb_build_array(jsonb_build_object('FAIL','T3_link_inserted','ctx',v_e1));
  END IF;

  -- T4 link updated
  v_e2 := public.admin_link_content_nodes(v_a, v_b, 'internal_link', 'anchor', 5);
  v_cond := v_e2->>'action' = 'updated';
  IF v_cond THEN v_pass := v_pass+1;
  ELSE v_fail := v_fail+1; v_failures := v_failures || jsonb_build_array(jsonb_build_object('FAIL','T4_link_updated','ctx',v_e2));
  END IF;

  -- Wire fully
  PERFORM public.admin_link_content_nodes(v_a, v_c, 'funnel_next');
  PERFORM public.admin_link_content_nodes(v_a, v_d, 'money_page');
  PERFORM public.admin_link_content_nodes(v_b, v_a, 'internal_link');

  v_orphans_root := public.admin_get_content_graph_orphans();
  WITH src AS (SELECT jsonb_array_elements(v_orphans_root->'orphans') AS o)
  SELECT COALESCE(jsonb_agg(o), '[]'::jsonb) INTO v_orphans
  FROM src
  WHERE o->>'node_slug' LIKE v_prefix || '%';

  -- T5 isolated all 4 missing
  SELECT COUNT(*) = 1 INTO v_cond
  FROM jsonb_array_elements(v_orphans) x
  WHERE x->>'node_slug' = v_prefix||'iso'
    AND (x->>'missing_inbound')::bool
    AND (x->>'missing_outbound')::bool
    AND (x->>'missing_funnel_next')::bool
    AND (x->>'missing_money_page')::bool;
  IF v_cond THEN v_pass := v_pass+1;
  ELSE v_fail := v_fail+1; v_failures := v_failures || jsonb_build_array(jsonb_build_object('FAIL','T5_isolated_all_missing','ctx',v_orphans));
  END IF;

  -- T6 a fully wired => not orphan
  v_cond := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_orphans) x WHERE x->>'node_slug' = v_prefix||'a');
  IF v_cond THEN v_pass := v_pass+1;
  ELSE v_fail := v_fail+1; v_failures := v_failures || jsonb_build_array(jsonb_build_object('FAIL','T6_a_fully_wired_not_orphan','ctx',v_orphans));
  END IF;

  -- T7 c inbound only
  SELECT COUNT(*) = 1 INTO v_cond
  FROM jsonb_array_elements(v_orphans) x
  WHERE x->>'node_slug' = v_prefix||'c'
    AND (x->>'missing_inbound')::bool      = false
    AND (x->>'missing_outbound')::bool     = true
    AND (x->>'missing_funnel_next')::bool  = true
    AND (x->>'missing_money_page')::bool   = true;
  IF v_cond THEN v_pass := v_pass+1;
  ELSE v_fail := v_fail+1; v_failures := v_failures || jsonb_build_array(jsonb_build_object('FAIL','T7_c_inbound_only','ctx',v_orphans));
  END IF;

  -- Cleanup
  DELETE FROM public.growth_content_graph_nodes WHERE node_slug LIKE v_prefix || '%';
  DELETE FROM public.auto_heal_log
    WHERE action_type IN ('growth_content_node_register','growth_content_edge_link')
      AND metadata->>'node_slug' LIKE v_prefix || '%';
  DELETE FROM public.user_roles WHERE user_id = v_uid;
  PERFORM set_config('request.jwt.claims', NULL, true);

  RETURN jsonb_build_object(
    'pass', v_pass,
    'fail', v_fail,
    'failures', v_failures
  );
EXCEPTION WHEN OTHERS THEN
  DELETE FROM public.growth_content_graph_nodes WHERE node_slug LIKE v_prefix || '%';
  DELETE FROM public.user_roles WHERE user_id = v_uid;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE;
END $fn$;

REVOKE ALL ON FUNCTION public._smoke_growth_content_graph() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._smoke_growth_content_graph() TO service_role;
