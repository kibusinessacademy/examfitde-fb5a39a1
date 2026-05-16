
-- Migration D: Admin-Repair + Cockpit

CREATE OR REPLACE FUNCTION public.admin_repair_purchase_delivery(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  v_enqueued int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'order not found: %', p_order_id;
  END IF;

  FOREACH v_jt IN ARRAY v_jts LOOP
    BEGIN
      INSERT INTO public.job_queue(job_type, status, payload, priority, idempotency_key, meta, lane)
      VALUES (
        v_jt, 'pending',
        jsonb_build_object('order_id', p_order_id, 'enqueue_source', 'admin_repair'),
        80,
        'post_purchase_repair|' || v_jt || '|' || p_order_id::text || '|' || to_char(now(),'YYYYMMDDHH24MISS'),
        jsonb_build_object('_origin','admin_repair_purchase_delivery','order_id', p_order_id),
        'commerce'
      );
      v_enqueued := v_enqueued + 1;
    EXCEPTION WHEN unique_violation THEN NULL; END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('admin_repair_purchase_delivery','order', p_order_id,'success',
          'enqueued ' || v_enqueued || ' repair jobs',
          jsonb_build_object('order_id', p_order_id, 'enqueued', v_enqueued, 'actor', auth.uid()));

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'enqueued', v_enqueued);
END $$;

CREATE OR REPLACE FUNCTION public.admin_repair_learner_entitlement(p_grant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_g RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT * INTO v_g FROM public.learner_course_grants WHERE id = p_grant_id;
  IF v_g IS NULL THEN
    RAISE EXCEPTION 'grant not found: %', p_grant_id;
  END IF;

  -- Re-trigger Bridge (idempotent in grant_learner_course_access)
  PERFORM public.grant_learner_course_access(
    v_g.user_id, v_g.curriculum_id, v_g.product_id,
    COALESCE(v_g.source,'order'), v_g.order_id,
    COALESCE(v_g.metadata,'{}'::jsonb) || jsonb_build_object('repair_actor', auth.uid())
  );

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('admin_repair_learner_entitlement','grant', p_grant_id,'success',
          'entitlement bridge re-triggered',
          jsonb_build_object('grant_id', p_grant_id, 'user_id', v_g.user_id, 'curriculum_id', v_g.curriculum_id, 'actor', auth.uid()));

  RETURN jsonb_build_object('ok', true, 'grant_id', p_grant_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_paid_but_not_delivered(p_limit int DEFAULT 100)
RETURNS TABLE (
  order_id uuid, buyer_user_id uuid, learner_user_id uuid, billing_email text,
  total_cents int, paid_at timestamptz,
  delivery_status text, delivery_blocking_reasons text[],
  delivery_last_checked_at timestamptz,
  age_minutes int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    o.id, o.buyer_user_id, o.learner_user_id, o.billing_email,
    o.total_cents, o.created_at,
    o.delivery_status, o.delivery_blocking_reasons, o.delivery_last_checked_at,
    EXTRACT(EPOCH FROM (now() - o.created_at))::int / 60 AS age_minutes
  FROM public.orders o
  WHERE public.has_role(auth.uid(), 'admin')
    AND o.status = 'paid'
    AND o.delivery_status <> 'confirmed'
  ORDER BY o.created_at ASC
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.admin_repair_purchase_delivery(uuid)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_repair_learner_entitlement(uuid)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_paid_but_not_delivered(int)       FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_repair_purchase_delivery(uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_repair_learner_entitlement(uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_paid_but_not_delivered(int)    TO authenticated, service_role;

INSERT INTO public.auto_heal_log(action_type, target_type, result_status, result_detail, metadata)
VALUES ('post_purchase_delivery_assurance_v1_migration_d','system','success',
        'admin_repair_purchase_delivery + admin_repair_learner_entitlement + admin_get_paid_but_not_delivered live',
        jsonb_build_object('migration','D','timestamp', now()));
