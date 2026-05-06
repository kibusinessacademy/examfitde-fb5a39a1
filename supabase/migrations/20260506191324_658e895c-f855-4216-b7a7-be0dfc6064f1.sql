CREATE OR REPLACE FUNCTION public.admin_repair_package_default_pricing(p_package_id uuid, p_reason text DEFAULT 'admin_pricing_repair'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg record; v_product record; v_price_id uuid;
  v_default_stripe_price_id text := 'price_1TKgFDDxqdaWCpJ6cquKeCog';
  v_default_amount_cents int := 2490;
  v_blocked_before text;
  v_ready_before boolean := false; v_ready_after boolean := false;
  v_updated_price boolean := false; v_inserted_price boolean := false;
  v_product_unarchived boolean := false; v_step_reset boolean := false; v_job_enqueued boolean := false;
  v_active_stripe_count int := 0; v_result_status text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid,'admin'::public.app_role) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT cp.* INTO v_pkg FROM public.course_packages cp WHERE cp.id=p_package_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','package_not_found'); END IF;
  v_blocked_before := v_pkg.blocked_reason;
  IF v_pkg.product_id IS NULL THEN
    INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
    VALUES ('pricing_default_repair','course_package',p_package_id::text,'skipped',
      jsonb_build_object('reason','package_product_id_missing','triggered_by',v_uid,'input_reason',p_reason));
    RETURN jsonb_build_object('ok',false,'error','package_product_id_missing');
  END IF;
  SELECT p.* INTO v_product FROM products p WHERE p.id=v_pkg.product_id;
  IF NOT FOUND THEN
    INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
    VALUES ('pricing_default_repair','course_package',p_package_id::text,'skipped',
      jsonb_build_object('reason','product_row_missing','triggered_by',v_uid,'input_reason',p_reason));
    RETURN jsonb_build_object('ok',false,'error','product_row_missing');
  END IF;
  v_ready_before := EXISTS(SELECT 1 FROM product_prices pp WHERE pp.product_id=v_pkg.product_id AND pp.active=true AND pp.stripe_price_id IS NOT NULL AND pp.stripe_price_id<>'');
  IF v_product.status='archived' AND COALESCE(v_product.active_package_id,p_package_id)=p_package_id THEN
    UPDATE products SET status='draft', visibility=COALESCE(visibility,'private'), updated_at=now() WHERE id=v_product.id;
    v_product_unarchived := true;
  END IF;
  SELECT pp.id INTO v_price_id FROM product_prices pp
  WHERE pp.product_id=v_pkg.product_id AND pp.active=true AND pp.amount_cents=v_default_amount_cents
  ORDER BY pp.updated_at DESC NULLS LAST, pp.created_at DESC LIMIT 1;
  IF v_price_id IS NOT NULL THEN
    UPDATE product_prices
    SET stripe_price_id=COALESCE(NULLIF(stripe_price_id,''),v_default_stripe_price_id),
        currency=COALESCE(currency,'EUR'), billing_type=COALESCE(billing_type,'one_time'),
        access_months=COALESCE(access_months,12), updated_at=now()
    WHERE id=v_price_id AND (stripe_price_id IS NULL OR stripe_price_id='' OR currency IS NULL OR billing_type IS NULL OR access_months IS NULL);
    GET DIAGNOSTICS v_updated_price = ROW_COUNT;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM product_prices pp WHERE pp.product_id=v_pkg.product_id AND pp.active=true AND pp.stripe_price_id IS NOT NULL AND pp.stripe_price_id<>'') THEN
    INSERT INTO product_prices(product_id,currency,amount_cents,billing_type,access_months,active,stripe_price_id)
    VALUES (v_pkg.product_id,'EUR',v_default_amount_cents,'one_time',12,true,v_default_stripe_price_id)
    RETURNING id INTO v_price_id;
    v_inserted_price := true;
  END IF;
  -- HARD VERIFY
  SELECT count(*) INTO v_active_stripe_count FROM product_prices pp
  WHERE pp.product_id=v_pkg.product_id AND pp.active=true AND pp.stripe_price_id IS NOT NULL AND pp.stripe_price_id<>'';
  v_ready_after := v_active_stripe_count>0;
  IF NOT v_ready_after THEN
    INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
    VALUES ('pricing_default_repair','course_package',p_package_id::text,'partial',
      jsonb_build_object('reason','verify_failed_no_active_stripe_price','product_id',v_pkg.product_id,
        'inserted_price',v_inserted_price,'updated_price',v_updated_price,'active_stripe_count',v_active_stripe_count,
        'triggered_by',v_uid,'input_reason',p_reason,'blocked_before',v_blocked_before));
    RETURN jsonb_build_object('ok',false,'error','verify_failed','ready_after',false);
  END IF;
  IF v_pkg.status='blocked' THEN
    UPDATE course_packages SET status='building', blocked_reason=NULL,
      stuck_reason=CASE WHEN stuck_reason ILIKE '%PRICING_HARD_GATE%' THEN NULL ELSE stuck_reason END,
      updated_at=now() WHERE id=p_package_id;
  ELSE
    UPDATE course_packages SET blocked_reason=CASE WHEN blocked_reason='pricing_config_missing' THEN NULL ELSE blocked_reason END,
      stuck_reason=CASE WHEN stuck_reason ILIKE '%PRICING_HARD_GATE%' THEN NULL ELSE stuck_reason END,
      updated_at=now() WHERE id=p_package_id;
  END IF;
  UPDATE package_steps SET status='queued'::public.step_status, attempts=0, last_error=NULL,
    meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object('pricing_repaired_at',now(),'pricing_repair_reason',p_reason)
  WHERE package_id=p_package_id AND step_key='auto_publish';
  GET DIAGNOSTICS v_step_reset = ROW_COUNT;
  IF NOT EXISTS(SELECT 1 FROM job_queue jq WHERE jq.package_id=p_package_id AND jq.job_type='package_auto_publish' AND jq.status IN ('pending','queued','processing','running')) THEN
    BEGIN
      INSERT INTO job_queue(job_type,package_id,status,payload,idempotency_key)
      VALUES ('package_auto_publish',p_package_id,'pending',
        jsonb_build_object('package_id',p_package_id,'curriculum_id',v_pkg.curriculum_id,'step_key','auto_publish','enqueue_source','pricing_default_repair'),
        'pricing_repair_'||p_package_id::text||'_'||extract(epoch from now())::bigint);
      v_job_enqueued := true;
    EXCEPTION WHEN OTHERS THEN v_job_enqueued := false;
    END;
  END IF;
  v_result_status := CASE WHEN v_ready_after AND (v_job_enqueued OR EXISTS(SELECT 1 FROM job_queue jq WHERE jq.package_id=p_package_id AND jq.job_type='package_auto_publish' AND jq.status IN ('pending','queued','processing','running'))) THEN 'success' ELSE 'partial' END;
  INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES ('pricing_default_repair','course_package',p_package_id::text,v_result_status,
    jsonb_build_object('reason',p_reason,'product_id',v_pkg.product_id,
      'ready_before',v_ready_before,'ready_after',v_ready_after,
      'inserted_price',v_inserted_price,'updated_price',v_updated_price,
      'product_unarchived',v_product_unarchived,'step_reset',v_step_reset,'job_enqueued',v_job_enqueued,
      'blocked_before',v_blocked_before,'triggered_by',v_uid));
  RETURN jsonb_build_object('ok',true,'ready_after',true,'inserted_price',v_inserted_price,'updated_price',v_updated_price,
    'product_unarchived',v_product_unarchived,'step_reset',v_step_reset,'job_enqueued',v_job_enqueued,'result_status',v_result_status);
END $function$;

REVOKE ALL ON FUNCTION public.admin_repair_package_default_pricing(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_repair_package_default_pricing(uuid,text) TO service_role, authenticated;

CREATE OR REPLACE VIEW public.v_pricing_gap_by_track AS
WITH gaps AS (
  SELECT cp.id AS package_id, cp.title, cp.status::text AS status,
    COALESCE(cp.track::text,'UNKNOWN') AS track, cp.product_id,
    CASE
      WHEN cp.product_id IS NULL THEN 'NO_PRODUCT_LINK'
      WHEN NOT EXISTS(SELECT 1 FROM product_prices pp WHERE pp.product_id=cp.product_id AND pp.active=true) THEN 'NO_ACTIVE_PRICE'
      WHEN NOT EXISTS(SELECT 1 FROM product_prices pp WHERE pp.product_id=cp.product_id AND pp.active=true AND pp.stripe_price_id IS NOT NULL AND pp.stripe_price_id<>'') THEN 'STRIPE_PRICE_ID_MISSING'
      ELSE 'OK'
    END AS gap_type
  FROM course_packages cp
  WHERE cp.status::text IN ('queued','building','blocked','published')
)
SELECT track, gap_type, count(*) AS package_count,
  jsonb_agg(jsonb_build_object('id',package_id,'title',title,'status',status) ORDER BY title) AS packages
FROM gaps WHERE gap_type<>'OK' GROUP BY track, gap_type;

REVOKE ALL ON public.v_pricing_gap_by_track FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pricing_gap_by_track TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_pricing_gap_by_track()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid:=auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid,'admin'::public.app_role) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('generated_at',now(),
    'total_gaps',(SELECT COALESCE(sum(package_count),0) FROM v_pricing_gap_by_track),
    'by_track_gate',COALESCE(jsonb_agg(row_to_json(t)),'[]'::jsonb)) INTO v_result FROM v_pricing_gap_by_track t;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.admin_get_pricing_gap_by_track() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_pricing_gap_by_track() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_pricing_heal_runs(p_hours int DEFAULT 168)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid:=auth.uid(); v_runs jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid,'admin'::public.app_role) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(r)),'[]'::jsonb) INTO v_runs FROM (
    SELECT ahl.id, ahl.created_at, ahl.target_id AS package_id, cp.title AS package_title,
      ahl.result_status, ahl.metadata->>'reason' AS reason,
      ahl.metadata->>'blocked_before' AS blocked_before, cp.blocked_reason AS blocked_after,
      (ahl.metadata->>'ready_before')::boolean AS ready_before,
      (ahl.metadata->>'ready_after')::boolean AS ready_after,
      (ahl.metadata->>'inserted_price')::boolean AS inserted_price,
      (ahl.metadata->>'job_enqueued')::boolean AS job_enqueued,
      ahl.metadata->>'triggered_by' AS triggered_by
    FROM auto_heal_log ahl
    LEFT JOIN course_packages cp ON cp.id::text=ahl.target_id
    WHERE ahl.action_type='pricing_default_repair'
      AND ahl.created_at > now()-make_interval(hours=>p_hours)
    ORDER BY ahl.created_at DESC LIMIT 200
  ) r;
  RETURN jsonb_build_object('generated_at',now(),'window_hours',p_hours,'runs',v_runs);
END $$;
REVOKE ALL ON FUNCTION public.admin_get_pricing_heal_runs(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_pricing_heal_runs(int) TO authenticated, service_role;