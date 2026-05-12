
CREATE OR REPLACE FUNCTION public.admin_smoke_launch_orders_health_repair_parity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_overall boolean := true;
  v_prod_with_curr uuid; v_prod_no_curr uuid; v_curr_id uuid;
  v_uid_synth uuid := gen_random_uuid();
  v_uid_no_grant uuid := gen_random_uuid();
  v_uid_with_grant uuid := gen_random_uuid();
  v_uid_no_items uuid := gen_random_uuid();
  v_uid_no_curr uuid := gen_random_uuid();
  v_o_synth uuid; v_o_no_grant uuid; v_o_with_grant uuid; v_o_no_items uuid; v_o_no_curr uuid;
  v_health jsonb; v_health_count int;
  v_repair jsonb; v_repair_ids uuid[];
  v_pass boolean;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;

  SELECT id, curriculum_id INTO v_prod_with_curr, v_curr_id
  FROM products WHERE status='active' AND curriculum_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_prod_no_curr FROM products WHERE curriculum_id IS NULL LIMIT 1;
  IF v_prod_with_curr IS NULL OR v_prod_no_curr IS NULL THEN
    RAISE EXCEPTION 'fixtures missing';
  END IF;

  INSERT INTO orders(buyer_user_id,status,stripe_checkout_session_id,currency,tax_mode,total_cents)
  VALUES (v_uid_synth,'paid','cs_test_synthetic_smoke_'||gen_random_uuid()::text,'eur','gross',1000)
  RETURNING id INTO v_o_synth;
  INSERT INTO order_items(order_id,product_id,quantity,unit_amount_net_cents,unit_amount_gross_cents)
  VALUES (v_o_synth,v_prod_with_curr,1,1000,1000);

  INSERT INTO orders(buyer_user_id,status,stripe_checkout_session_id,currency,tax_mode,total_cents)
  VALUES (v_uid_no_grant,'paid','cs_live_smoke_'||gen_random_uuid()::text,'eur','gross',1000)
  RETURNING id INTO v_o_no_grant;
  INSERT INTO order_items(order_id,product_id,quantity,unit_amount_net_cents,unit_amount_gross_cents)
  VALUES (v_o_no_grant,v_prod_with_curr,1,1000,1000);

  INSERT INTO orders(buyer_user_id,status,stripe_checkout_session_id,currency,tax_mode,total_cents)
  VALUES (v_uid_with_grant,'paid','cs_live_smoke_'||gen_random_uuid()::text,'eur','gross',1000)
  RETURNING id INTO v_o_with_grant;
  INSERT INTO order_items(order_id,product_id,quantity,unit_amount_net_cents,unit_amount_gross_cents)
  VALUES (v_o_with_grant,v_prod_with_curr,1,1000,1000);
  INSERT INTO learner_course_grants(user_id,curriculum_id,product_id,source,source_ref,order_id,status)
  VALUES (v_uid_with_grant,v_curr_id,v_prod_with_curr,'web','smoke',v_o_with_grant,'active');

  INSERT INTO orders(buyer_user_id,status,stripe_checkout_session_id,currency,tax_mode,total_cents)
  VALUES (v_uid_no_items,'paid','cs_live_smoke_'||gen_random_uuid()::text,'eur','gross',0)
  RETURNING id INTO v_o_no_items;

  INSERT INTO orders(buyer_user_id,status,stripe_checkout_session_id,currency,tax_mode,total_cents)
  VALUES (v_uid_no_curr,'paid','cs_live_smoke_'||gen_random_uuid()::text,'eur','gross',1000)
  RETURNING id INTO v_o_no_curr;
  INSERT INTO order_items(order_id,product_id,quantity,unit_amount_net_cents,unit_amount_gross_cents)
  VALUES (v_o_no_curr,v_prod_no_curr,1,1000,1000);

  v_health := public.fn_launch_orders_health();

  SELECT count(*) INTO v_health_count
  FROM orders o
  WHERE o.id = ANY(ARRAY[v_o_synth,v_o_no_grant,v_o_with_grant,v_o_no_items,v_o_no_curr])
    AND o.status='paid'
    AND COALESCE(o.stripe_checkout_session_id,'') NOT LIKE 'cs_test_synthetic%'
    AND COALESCE(o.stripe_checkout_session_id,'') NOT LIKE 'cs_test_access%'
    AND COALESCE(o.learner_user_id,o.buyer_user_id) IS NOT NULL
    AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id)
    AND EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
                WHERE oi.order_id=o.id AND p.curriculum_id IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
                    JOIN learner_course_grants g ON g.user_id=COALESCE(o.learner_user_id,o.buyer_user_id)
                      AND g.curriculum_id=p.curriculum_id
                    WHERE oi.order_id=o.id);

  v_pass := v_health_count = 1;
  IF NOT v_pass THEN v_overall := false; END IF;
  v_results := v_results || jsonb_build_object('check','health_smoke_eligible_count_eq_1','pass',v_pass,
    'detail',jsonb_build_object('expected',1,'actual',v_health_count,'global_health',v_health));

  v_repair := public.admin_repair_paid_orders_without_grant(NULL, true);

  SELECT array_agg((elem->>'order_id')::uuid)
    INTO v_repair_ids
  FROM jsonb_array_elements(COALESCE(v_repair->'rows','[]'::jsonb)) elem
  WHERE (elem->>'order_id')::uuid = ANY(ARRAY[v_o_synth,v_o_no_grant,v_o_with_grant,v_o_no_items,v_o_no_curr]);

  v_pass := v_repair_ids IS NOT NULL AND v_o_no_grant = ANY(v_repair_ids);
  IF NOT v_pass THEN v_overall := false; END IF;
  v_results := v_results || jsonb_build_object('check','repair_includes_no_grant_order','pass',v_pass,
    'detail',jsonb_build_object('expected',v_o_no_grant,'actual',v_repair_ids));

  v_pass := v_repair_ids IS NULL OR NOT (v_o_synth = ANY(v_repair_ids));
  IF NOT v_pass THEN v_overall := false; END IF;
  v_results := v_results || jsonb_build_object('check','repair_excludes_synthetic_session','pass',v_pass);

  v_pass := v_repair_ids IS NULL OR NOT (v_o_with_grant = ANY(v_repair_ids));
  IF NOT v_pass THEN v_overall := false; END IF;
  v_results := v_results || jsonb_build_object('check','repair_excludes_already_granted','pass',v_pass);

  v_pass := v_repair_ids IS NULL OR NOT (v_o_no_items = ANY(v_repair_ids));
  IF NOT v_pass THEN v_overall := false; END IF;
  v_results := v_results || jsonb_build_object('check','repair_excludes_no_items','pass',v_pass);

  v_pass := v_repair_ids IS NULL OR NOT (v_o_no_curr = ANY(v_repair_ids));
  IF NOT v_pass THEN v_overall := false; END IF;
  v_results := v_results || jsonb_build_object('check','repair_excludes_no_curriculum_product','pass',v_pass);

  v_pass := v_health_count = COALESCE(array_length(v_repair_ids,1),0);
  IF NOT v_pass THEN v_overall := false; END IF;
  v_results := v_results || jsonb_build_object('check','parity_health_eq_repair','pass',v_pass,
    'detail',jsonb_build_object('health_count',v_health_count,'repair_count',COALESCE(array_length(v_repair_ids,1),0)));

  DELETE FROM learner_course_grants WHERE order_id IN (v_o_synth,v_o_no_grant,v_o_with_grant,v_o_no_items,v_o_no_curr);
  DELETE FROM order_items WHERE order_id IN (v_o_synth,v_o_no_grant,v_o_with_grant,v_o_no_items,v_o_no_curr);
  DELETE FROM orders WHERE id IN (v_o_synth,v_o_no_grant,v_o_with_grant,v_o_no_items,v_o_no_curr);

  INSERT INTO auto_heal_log(action_type,target_type,result_status,metadata)
  VALUES ('admin_smoke_launch_orders_parity','system',
    CASE WHEN v_overall THEN 'success' ELSE 'failure' END,
    jsonb_build_object('overall',v_overall,'checks',v_results));

  RETURN jsonb_build_object('overall_pass',v_overall,'checks',v_results);

EXCEPTION WHEN OTHERS THEN
  BEGIN
    DELETE FROM learner_course_grants WHERE order_id IN (v_o_synth,v_o_no_grant,v_o_with_grant,v_o_no_items,v_o_no_curr);
    DELETE FROM order_items WHERE order_id IN (v_o_synth,v_o_no_grant,v_o_with_grant,v_o_no_items,v_o_no_curr);
    DELETE FROM orders WHERE id IN (v_o_synth,v_o_no_grant,v_o_with_grant,v_o_no_items,v_o_no_curr);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  INSERT INTO auto_heal_log(action_type,target_type,result_status,metadata)
  VALUES ('admin_smoke_launch_orders_parity','system','error',
    jsonb_build_object('error',SQLERRM,'sqlstate',SQLSTATE,'partial_results',v_results));
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_smoke_launch_orders_health_repair_parity() TO service_role;
