-- Layer 3: Partial unique index must skip order-keyed jobs.
DROP INDEX IF EXISTS public.job_queue_unique_global_job;
CREATE UNIQUE INDEX job_queue_unique_global_job
  ON public.job_queue
  USING btree (job_type, COALESCE((payload->>'curriculum_id'),''))
  WHERE status IN ('pending','processing')
    AND package_id IS NULL
    AND job_type NOT LIKE 'post_purchase_%'
    AND job_type NOT LIKE 'notification_%';

-- Backfill remaining 35 orders.
DO $$
DECLARE
  r RECORD; v_jt text; v_enq int := 0; v_orders int := 0;
  v_jts text[] := ARRAY[
    'post_purchase_entitlement_create','post_purchase_license_assign',
    'post_purchase_course_access_verify','post_purchase_feature_access_verify',
    'post_purchase_first_lesson_probe','post_purchase_delivery_audit_snapshot'
  ];
BEGIN
  FOR r IN
    SELECT o.id FROM public.orders o
    WHERE o.status='paid' AND COALESCE(o.delivery_status,'pending')<>'confirmed'
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue j
         WHERE j.idempotency_key = 'post_purchase|post_purchase_delivery_audit_snapshot|' || o.id::text
      )
    ORDER BY o.created_at ASC
  LOOP
    v_orders := v_orders + 1;
    FOREACH v_jt IN ARRAY v_jts LOOP
      BEGIN
        INSERT INTO public.job_queue(job_type,status,payload,priority,idempotency_key,meta,lane)
        VALUES (v_jt,'pending',
          jsonb_build_object('order_id', r.id, 'enqueue_source','backfill_paid_orders_guard_fix_v2'),
          70,
          'post_purchase|' || v_jt || '|' || r.id::text,
          jsonb_build_object('_origin','backfill_guard_fix_v2','order_id', r.id),
          'commerce');
        v_enq := v_enq + 1;
      EXCEPTION WHEN unique_violation THEN NULL; END;
    END LOOP;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type,target_type,result_status,result_detail,metadata)
  VALUES ('post_purchase_delivery_backfill','system','success',
          'orders=' || v_orders || ' jobs_enqueued=' || v_enq,
          jsonb_build_object('orders',v_orders,'jobs_enqueued',v_enq,
                             'reason','unique_index_global_job exemption + retry'));
END $$;