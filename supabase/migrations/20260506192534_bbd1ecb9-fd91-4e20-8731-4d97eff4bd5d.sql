CREATE OR REPLACE FUNCTION public.admin_repair_package_default_pricing(p_package_id uuid, p_reason text DEFAULT 'admin_pricing_repair'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_jobs_after jsonb := '[]'::jsonb;
  v_lxi_summary jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid,'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

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

  v_ready_before := EXISTS(SELECT 1 FROM product_prices pp
    WHERE pp.product_id=v_pkg.product_id AND pp.active=true
      AND pp.stripe_price_id IS NOT NULL AND pp.stripe_price_id<>'');

  -- ATOMIC BLOCK: alle Mutationen + Verify in einem SAVEPOINT.
  -- Bei Verify-Fail werden Unarchive/Insert/Update zurückgerollt → kein invalider Zwischenstand.
  BEGIN
    IF v_product.status='archived' AND COALESCE(v_product.active_package_id,p_package_id)=p_package_id THEN
      UPDATE products SET status='draft', visibility=COALESCE(visibility,'private'), updated_at=now()
      WHERE id=v_product.id;
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

    IF NOT EXISTS(SELECT 1 FROM product_prices pp
      WHERE pp.product_id=v_pkg.product_id AND pp.active=true
        AND pp.stripe_price_id IS NOT NULL AND pp.stripe_price_id<>'') THEN
      INSERT INTO product_prices(product_id,currency,amount_cents,billing_type,access_months,active,stripe_price_id)
      VALUES (v_pkg.product_id,'EUR',v_default_amount_cents,'one_time',12,true,v_default_stripe_price_id)
      RETURNING id INTO v_price_id;
      v_inserted_price := true;
    END IF;

    SELECT count(*) INTO v_active_stripe_count FROM product_prices pp
    WHERE pp.product_id=v_pkg.product_id AND pp.active=true
      AND pp.stripe_price_id IS NOT NULL AND pp.stripe_price_id<>'';
    v_ready_after := v_active_stripe_count>0;

    IF NOT v_ready_after THEN
      RAISE EXCEPTION 'verify_failed_no_active_stripe_price';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Side-Effects rollen automatisch zurück (Savepoint endet hier).
    INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
    VALUES ('pricing_default_repair','course_package',p_package_id::text,'partial',
      jsonb_build_object('reason','verify_failed_no_active_stripe_price','product_id',v_pkg.product_id,
        'attempted_insert',v_inserted_price,'attempted_update',v_updated_price,
        'attempted_unarchive',v_product_unarchived,'active_stripe_count',v_active_stripe_count,
        'sql_error',SQLERRM,'triggered_by',v_uid,'input_reason',p_reason,
        'blocked_before',v_blocked_before));
    RETURN jsonb_build_object('ok',false,'error','verify_failed','ready_after',false);
  END;

  -- Verify war erfolgreich → Status- und Step-Heilung anwenden.
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

  IF NOT EXISTS(SELECT 1 FROM job_queue jq WHERE jq.package_id=p_package_id
    AND jq.job_type='package_auto_publish' AND jq.status IN ('pending','queued','processing','running')) THEN
    BEGIN
      INSERT INTO job_queue(job_type,package_id,status,payload,idempotency_key)
      VALUES ('package_auto_publish',p_package_id,'pending',
        jsonb_build_object('package_id',p_package_id,'curriculum_id',v_pkg.curriculum_id,
          'step_key','auto_publish','enqueue_source','pricing_default_repair'),
        'pricing_repair_'||p_package_id::text||'_'||extract(epoch from now())::bigint);
      v_job_enqueued := true;
    EXCEPTION WHEN OTHERS THEN v_job_enqueued := false;
    END;
  END IF;

  -- Auto-Publish Snapshot direkt nach Repair
  SELECT COALESCE(jsonb_agg(row_to_json(j) ORDER BY j.created_at DESC), '[]'::jsonb)
  INTO v_jobs_after
  FROM (
    SELECT jq.id, jq.status, jq.created_at, jq.payload->>'enqueue_source' AS enqueue_source
    FROM job_queue jq
    WHERE jq.package_id=p_package_id AND jq.job_type='package_auto_publish'
    ORDER BY jq.created_at DESC LIMIT 5
  ) j;

  v_result_status := CASE
    WHEN v_ready_after AND (v_job_enqueued OR EXISTS(
      SELECT 1 FROM job_queue jq WHERE jq.package_id=p_package_id AND jq.job_type='package_auto_publish'
        AND jq.status IN ('pending','queued','processing','running')))
    THEN 'success' ELSE 'partial' END;

  INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES ('pricing_default_repair','course_package',p_package_id::text,v_result_status,
    jsonb_build_object('reason',p_reason,'product_id',v_pkg.product_id,
      'ready_before',v_ready_before,'ready_after',v_ready_after,
      'inserted_price',v_inserted_price,'updated_price',v_updated_price,
      'product_unarchived',v_product_unarchived,'step_reset',v_step_reset,'job_enqueued',v_job_enqueued,
      'blocked_before',v_blocked_before,'auto_publish_jobs_after',v_jobs_after,
      'triggered_by',v_uid));

  -- LXI-Summary für sofortige UI-Aktualisierung mitgeben (best-effort)
  BEGIN
    SELECT public.admin_get_lxi_publish_block_summary(24) INTO v_lxi_summary;
  EXCEPTION WHEN OTHERS THEN v_lxi_summary := NULL;
  END;

  RETURN jsonb_build_object('ok',true,'ready_after',true,
    'inserted_price',v_inserted_price,'updated_price',v_updated_price,
    'product_unarchived',v_product_unarchived,'step_reset',v_step_reset,
    'job_enqueued',v_job_enqueued,'result_status',v_result_status,
    'auto_publish_jobs_after',v_jobs_after,
    'lxi_publish_block_summary',v_lxi_summary);
END $function$;