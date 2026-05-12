CREATE OR REPLACE FUNCTION public.admin_repair_paid_orders_without_grant(p_caller_id uuid DEFAULT NULL::uuid, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := COALESCE(p_caller_id, auth.uid());
  v_repaired int := 0; v_failed int := 0; v_rows jsonb := '[]'::jsonb; r record;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(v_caller) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;
  FOR r IN
    SELECT o.id AS order_id, COALESCE(o.learner_user_id,o.buyer_user_id) AS uid
    FROM public.orders o
    WHERE o.status='paid'
      AND COALESCE(o.stripe_checkout_session_id,'') NOT LIKE 'cs_test_synthetic%'
      AND COALESCE(o.stripe_checkout_session_id,'') NOT LIKE 'cs_test_access%'
      AND COALESCE(o.learner_user_id,o.buyer_user_id) IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id)
      AND EXISTS (SELECT 1 FROM public.order_items oi JOIN public.products p ON p.id=oi.product_id
                  WHERE oi.order_id=o.id AND p.curriculum_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM public.order_items oi
                      JOIN public.products p ON p.id=oi.product_id
                      JOIN public.learner_course_grants g
                        ON g.user_id=COALESCE(o.learner_user_id,o.buyer_user_id) AND g.curriculum_id=p.curriculum_id
                      WHERE oi.order_id=o.id)
      AND COALESCE(o.learner_user_id,o.buyer_user_id) NOT IN (
        SELECT id FROM auth.users
        WHERE email LIKE '%@examfit-smoke.local'
           OR email LIKE '%@test.examfit.de')
    LIMIT 50
  LOOP
    IF NOT p_dry_run THEN
      BEGIN
        PERFORM public.process_order_paid_fulfillment(r.order_id);
        v_repaired := v_repaired+1;
        v_rows := v_rows || jsonb_build_object('order_id',r.order_id,'user_id',r.uid,'status','ok');
      EXCEPTION WHEN others THEN
        v_failed := v_failed+1;
        v_rows := v_rows || jsonb_build_object('order_id',r.order_id,'user_id',r.uid,'status','error','error',SQLERRM);
        CONTINUE;
      END;
    ELSE
      v_rows := v_rows || jsonb_build_object('order_id',r.order_id,'user_id',r.uid,'dry_run',true);
    END IF;
  END LOOP;
  INSERT INTO public.auto_heal_log(action_type,target_type,result_status,metadata)
  VALUES ('system_audit_repair_paid_no_grant','system',
    CASE WHEN p_dry_run THEN 'dry_run' WHEN v_failed>0 THEN 'partial' ELSE 'success' END,
    jsonb_build_object('caller_id',v_caller,'repaired',v_repaired,'failed',v_failed,'rows',v_rows));
  RETURN jsonb_build_object('repaired',v_repaired,'failed',v_failed,'dry_run',p_dry_run,'rows',v_rows);
END; $function$;

DO $do$
DECLARE
  v_result jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  v_result := public.admin_smoke_launch_orders_health_repair_parity();
  RAISE NOTICE 'parity_smoke_result=%', v_result;
  RESET ROLE;
END;
$do$;