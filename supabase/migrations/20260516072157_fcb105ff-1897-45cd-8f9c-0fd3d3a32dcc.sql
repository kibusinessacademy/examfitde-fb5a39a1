
-- Migration C: Orchestrator-Pipeline

-- ============================================================
-- 1) Register 6 new job_types in ops_job_type_registry
-- ============================================================
INSERT INTO public.ops_job_type_registry (job_type, lane, requires_package_id)
VALUES
  ('post_purchase_entitlement_create',      'commerce', false),
  ('post_purchase_license_assign',          'commerce', false),
  ('post_purchase_course_access_verify',    'commerce', false),
  ('post_purchase_feature_access_verify',   'commerce', false),
  ('post_purchase_first_lesson_probe',      'commerce', false),
  ('post_purchase_delivery_audit_snapshot', 'commerce', false)
ON CONFLICT (job_type) DO UPDATE SET lane = EXCLUDED.lane;

-- ============================================================
-- 2) SECURITY DEFINER Check-RPCs (per job_type)
-- ============================================================

-- 2a) Entitlement-Create-Check: verifiziert, dass für alle Course-Items eine 
--     learner_course_grants+entitlements Bridge existiert (grant_learner_course_access
--     wird bereits durch trg_orders_paid_grant aufgerufen; hier nur Verify+Repair).
CREATE OR REPLACE FUNCTION public.fn_post_purchase_entitlement_create(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order RECORD;
  v_missing int := 0;
  v_total int := 0;
  v_row RECORD;
BEGIN
  SELECT id, buyer_user_id, learner_user_id, status INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order IS NULL OR v_order.status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_paid');
  END IF;

  FOR v_row IN
    SELECT DISTINCT p.curriculum_id, p.id AS product_id
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id AND p.curriculum_id IS NOT NULL
  LOOP
    v_total := v_total + 1;
    IF NOT EXISTS (
      SELECT 1 FROM public.learner_course_grants
      WHERE user_id = COALESCE(v_order.learner_user_id, v_order.buyer_user_id)
        AND curriculum_id = v_row.curriculum_id
        AND status = 'active'
    ) THEN
      -- Auto-Repair: re-trigger grant
      PERFORM public.grant_learner_course_access(
        COALESCE(v_order.learner_user_id, v_order.buyer_user_id),
        v_row.curriculum_id, v_row.product_id, 'order', v_order.id,
        jsonb_build_object('repair_source','post_purchase_entitlement_create')
      );
      v_missing := v_missing + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'total', v_total, 'repaired', v_missing,
    'reason', CASE WHEN v_missing > 0 THEN 'entitlement_repaired' ELSE 'all_present' END
  );
END $$;

-- 2b) License-Assign-Check (B2C: noop ok; B2B: license_seats wären zu prüfen — v1-placeholder)
CREATE OR REPLACE FUNCTION public.fn_post_purchase_license_assign(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order RECORD;
BEGIN
  SELECT id, customer_type FROM public.orders WHERE id = p_order_id INTO v_order;
  -- v1: B2C-Orders haben keine separate License-Assignment; B2B-Flow folgt in v2.
  RETURN jsonb_build_object('ok', true, 'reason', 'b2c_noop_v1',
    'customer_type', COALESCE(v_order.customer_type, 'b2c'));
END $$;

-- 2c) Course-Access-Verify: prüft v_learner_entitlements_ssot.status='active'
CREATE OR REPLACE FUNCTION public.fn_post_purchase_course_access_verify(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_active int; v_total int;
BEGIN
  SELECT COUNT(*) FILTER (WHERE status = 'active'), COUNT(*)
    INTO v_active, v_total
  FROM public.v_learner_entitlements_ssot
  WHERE order_id = p_order_id;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_grants_for_order');
  END IF;
  IF v_active < v_total THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'partial_access',
      'active', v_active, 'total', v_total);
  END IF;
  RETURN jsonb_build_object('ok', true, 'active', v_active, 'total', v_total);
END $$;

-- 2d) Feature-Access-Verify: alle 4 has_* Flags auf entitlements
CREATE OR REPLACE FUNCTION public.fn_post_purchase_feature_access_verify(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bad int;
BEGIN
  SELECT COUNT(*) INTO v_bad
  FROM public.v_learner_entitlements_ssot
  WHERE order_id = p_order_id
    AND (
      (access_scope->>'has_learning_course')::boolean IS NOT TRUE
      OR (access_scope->>'has_exam_trainer')::boolean IS NOT TRUE
      OR (access_scope->>'has_ai_tutor')::boolean IS NOT TRUE
      OR (access_scope->>'has_oral_trainer')::boolean IS NOT TRUE
    );
  IF v_bad > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_flags_incomplete', 'bad', v_bad);
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 2e) First-Lesson-Probe: prüft, dass für jede Bestellung ein Paket mit delivery_ready existiert
CREATE OR REPLACE FUNCTION public.fn_post_purchase_first_lesson_probe(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_unready int;
BEGIN
  SELECT COUNT(*) INTO v_unready
  FROM public.v_learner_entitlements_ssot e
  LEFT JOIN public.v_course_delivery_readiness dr ON dr.course_package_id = e.package_id
  WHERE e.order_id = p_order_id
    AND COALESCE(dr.delivery_ready, false) = false;
  IF v_unready > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lesson_unready_packages', 'count', v_unready);
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 2f) Delivery-Audit-Snapshot: aggregiert alle Checks + setzt orders.delivery_status
CREATE OR REPLACE FUNCTION public.fn_post_purchase_delivery_audit_snapshot(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ent jsonb; v_lic jsonb; v_acc jsonb; v_feat jsonb; v_les jsonb;
  v_reasons text[] := '{}'::text[];
  v_status text;
BEGIN
  v_ent  := public.fn_post_purchase_entitlement_create(p_order_id);
  v_lic  := public.fn_post_purchase_license_assign(p_order_id);
  v_acc  := public.fn_post_purchase_course_access_verify(p_order_id);
  v_feat := public.fn_post_purchase_feature_access_verify(p_order_id);
  v_les  := public.fn_post_purchase_first_lesson_probe(p_order_id);

  IF (v_acc->>'ok')::boolean IS NOT TRUE  THEN v_reasons := v_reasons || COALESCE(v_acc->>'reason','access_failed'); END IF;
  IF (v_feat->>'ok')::boolean IS NOT TRUE THEN v_reasons := v_reasons || COALESCE(v_feat->>'reason','feature_failed'); END IF;
  IF (v_les->>'ok')::boolean IS NOT TRUE  THEN v_reasons := v_reasons || COALESCE(v_les->>'reason','lesson_unready'); END IF;

  v_status := CASE
    WHEN COALESCE(array_length(v_reasons, 1), 0) = 0 THEN 'confirmed'
    ELSE 'blocked'
  END;

  UPDATE public.orders
  SET delivery_status            = v_status,
      delivery_blocking_reasons  = v_reasons,
      delivery_confirmed_at      = CASE WHEN v_status = 'confirmed' THEN now() ELSE delivery_confirmed_at END,
      delivery_last_checked_at   = now()
  WHERE id = p_order_id;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'post_purchase_delivery', 'order', p_order_id,
    CASE WHEN v_status='confirmed' THEN 'success' ELSE 'warn' END,
    'delivery_audit_snapshot: ' || v_status,
    jsonb_build_object(
      'order_id', p_order_id, 'delivery_status', v_status,
      'reasons', v_reasons,
      'entitlement', v_ent, 'license', v_lic, 'access', v_acc, 'feature', v_feat, 'lesson', v_les
    )
  );

  RETURN jsonb_build_object('ok', v_status = 'confirmed', 'delivery_status', v_status, 'reasons', v_reasons);
END $$;

REVOKE ALL ON FUNCTION public.fn_post_purchase_entitlement_create(uuid)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_post_purchase_license_assign(uuid)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_post_purchase_course_access_verify(uuid)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_post_purchase_feature_access_verify(uuid)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_post_purchase_first_lesson_probe(uuid)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_post_purchase_delivery_audit_snapshot(uuid)   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_post_purchase_entitlement_create(uuid)      TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_post_purchase_license_assign(uuid)          TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_post_purchase_course_access_verify(uuid)    TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_post_purchase_feature_access_verify(uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_post_purchase_first_lesson_probe(uuid)      TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_post_purchase_delivery_audit_snapshot(uuid) TO service_role;

-- ============================================================
-- 3) Delivery-Fanout-Trigger on orders (paid)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_orders_paid_delivery_fanout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_jt text;
  v_jts text[] := ARRAY[
    'post_purchase_entitlement_create',
    'post_purchase_license_assign',
    'post_purchase_course_access_verify',
    'post_purchase_feature_access_verify',
    'post_purchase_first_lesson_probe',
    'post_purchase_delivery_audit_snapshot'
  ];
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.status = 'paid')
     OR (TG_OP = 'UPDATE' AND NEW.status = 'paid' AND COALESCE(OLD.status,'') <> 'paid') THEN

    -- Mark order as in_progress immediately
    NEW.delivery_status := COALESCE(NULLIF(NEW.delivery_status, 'confirmed'), 'in_progress');
    IF NEW.delivery_status <> 'confirmed' THEN
      NEW.delivery_status := 'in_progress';
    END IF;
    NEW.delivery_last_checked_at := now();

    FOREACH v_jt IN ARRAY v_jts LOOP
      BEGIN
        INSERT INTO public.job_queue(job_type, status, payload, priority, idempotency_key, meta, lane)
        VALUES (
          v_jt, 'pending',
          jsonb_build_object('order_id', NEW.id, 'enqueue_source', 'orders_paid_delivery_fanout'),
          50,
          'post_purchase|' || v_jt || '|' || NEW.id::text,
          jsonb_build_object('_origin','post_purchase_delivery_fanout','order_id', NEW.id),
          'commerce'
        );
      EXCEPTION WHEN unique_violation THEN
        NULL; -- idempotent
      END;
    END LOOP;

    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('post_purchase_delivery_fanout','order', NEW.id,'success',
            'enqueued 6 delivery jobs',
            jsonb_build_object('order_id', NEW.id, 'job_types', v_jts));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_orders_paid_delivery_fanout ON public.orders;
CREATE TRIGGER trg_orders_paid_delivery_fanout
  BEFORE INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_orders_paid_delivery_fanout();

-- ============================================================
-- 4) SLA Detector (2-min breach)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_detect_post_purchase_delivery_sla_breach(p_minutes int DEFAULT 2)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_breached int := 0; v_repaired int := 0; r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.orders
    WHERE status = 'paid'
      AND delivery_status <> 'confirmed'
      AND created_at < now() - (p_minutes::text || ' minutes')::interval
    ORDER BY created_at ASC
    LIMIT 100
  LOOP
    v_breached := v_breached + 1;
    BEGIN
      INSERT INTO public.job_queue(job_type, status, payload, priority, idempotency_key, meta, lane)
      VALUES (
        'post_purchase_delivery_audit_snapshot', 'pending',
        jsonb_build_object('order_id', r.id, 'enqueue_source', 'sla_breach_detector'),
        90,
        'post_purchase_sla|' || r.id::text || '|' || to_char(now(),'YYYYMMDDHH24MI'),
        jsonb_build_object('_origin','sla_breach','order_id', r.id),
        'commerce'
      );
      v_repaired := v_repaired + 1;
    EXCEPTION WHEN unique_violation THEN NULL; END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, result_detail, metadata)
  VALUES ('post_purchase_delivery_sla_breach','system',
          CASE WHEN v_breached=0 THEN 'success' ELSE 'warn' END,
          'breached=' || v_breached || ' repaired=' || v_repaired,
          jsonb_build_object('breached', v_breached, 'repaired', v_repaired, 'minutes', p_minutes));

  RETURN jsonb_build_object('breached', v_breached, 'repaired', v_repaired);
END $$;

REVOKE ALL ON FUNCTION public.fn_detect_post_purchase_delivery_sla_breach(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_detect_post_purchase_delivery_sla_breach(int) TO service_role;

INSERT INTO public.auto_heal_log(action_type, target_type, result_status, result_detail, metadata)
VALUES ('post_purchase_delivery_assurance_v1_migration_c','system','success',
        '6 job-types + delivery-fanout-trigger + 6 check-rpcs + sla-detector live',
        jsonb_build_object('migration','C','timestamp', now()));
