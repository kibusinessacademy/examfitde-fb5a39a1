
CREATE OR REPLACE FUNCTION public.fn_is_admin_or_service_role(_uid uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN RETURN true; END IF;
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN RETURN true; END IF;
  IF _uid IS NOT NULL AND public.has_role(_uid, 'admin'::app_role) THEN RETURN true; END IF;
  RETURN false;
END; $$;
REVOKE ALL ON FUNCTION public.fn_is_admin_or_service_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_is_admin_or_service_role(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_unblock_zombie_with_approved_questions(
  p_caller_id uuid DEFAULT NULL, p_dry_run boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := COALESCE(p_caller_id, auth.uid());
  v_unblocked int := 0; v_skipped int := 0; v_rows jsonb := '[]'::jsonb; r record;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(v_caller) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;
  FOR r IN
    SELECT cp.id AS package_id, cp.status AS prev_status, cp.blocked_reason AS prev_blocked_reason, cp.product_id,
           (SELECT COUNT(*) FROM public.exam_questions eq
              WHERE eq.curriculum_id=cp.curriculum_id AND eq.status='approved') AS approved_count,
           (SELECT COUNT(*) FROM public.product_prices pp
              WHERE pp.product_id=cp.product_id AND pp.active=true AND pp.stripe_price_id IS NOT NULL) AS active_price_count
    FROM public.course_packages cp
    WHERE cp.blocked_reason='auto_heal_zombie' AND cp.status IN ('blocked','queued') AND cp.product_id IS NOT NULL
  LOOP
    IF r.approved_count<50 OR r.active_price_count<1 THEN
      v_skipped := v_skipped+1;
      v_rows := v_rows || jsonb_build_object('package_id',r.package_id,'skipped',true,
        'approved_question_count',r.approved_count,'active_stripe_price_count',r.active_price_count,
        'reason',CASE WHEN r.approved_count<50 THEN 'insufficient_approved_questions' ELSE 'no_active_stripe_price' END);
      CONTINUE;
    END IF;
    IF NOT p_dry_run THEN
      UPDATE public.course_packages SET blocked_reason=NULL, status='building', updated_at=now() WHERE id=r.package_id;
      v_unblocked := v_unblocked+1;
    ELSE v_skipped := v_skipped+1; END IF;
    v_rows := v_rows || jsonb_build_object('package_id',r.package_id,'previous_status',r.prev_status,
      'previous_blocked_reason',r.prev_blocked_reason,'approved_question_count',r.approved_count,
      'product_id',r.product_id,'active_stripe_price_count',r.active_price_count,
      'publish_transition_reason','zombie_with_approved_questions_unblock','healed_by',v_caller,'dry_run',p_dry_run);
  END LOOP;
  INSERT INTO public.auto_heal_log(action_type,target_type,result_status,metadata)
  VALUES ('system_audit_unblock_zombie','system',
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
    jsonb_build_object('caller_id',v_caller,'unblocked',v_unblocked,'skipped',v_skipped,'rows',v_rows));
  RETURN jsonb_build_object('unblocked',v_unblocked,'skipped',v_skipped,'dry_run',p_dry_run,'rows',v_rows);
END; $$;
REVOKE ALL ON FUNCTION public.admin_unblock_zombie_with_approved_questions(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unblock_zombie_with_approved_questions(uuid,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_repair_grant_entitlement_drift(
  p_caller_id uuid DEFAULT NULL, p_dry_run boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := COALESCE(p_caller_id, auth.uid());
  v_repaired int := 0; v_rows jsonb := '[]'::jsonb; r record;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(v_caller) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;
  FOR r IN
    SELECT g.user_id, g.curriculum_id, g.product_id
    FROM public.learner_course_grants g
    WHERE g.status='active'
      AND NOT EXISTS (SELECT 1 FROM public.entitlements e WHERE e.user_id=g.user_id AND e.curriculum_id=g.curriculum_id)
    LIMIT 200
  LOOP
    IF NOT p_dry_run THEN
      INSERT INTO public.entitlements(user_id,curriculum_id,product_id,valid_from,valid_until,
        source,source_type,has_learning_course,has_exam_trainer,has_ai_tutor,has_oral_trainer)
      SELECT r.user_id,r.curriculum_id,r.product_id,now(),now()+interval '12 months',
             'web','admin_grant',true,true,true,true
      WHERE NOT EXISTS (SELECT 1 FROM public.entitlements e2 WHERE e2.user_id=r.user_id AND e2.curriculum_id=r.curriculum_id);
      v_repaired := v_repaired+1;
    END IF;
    v_rows := v_rows || jsonb_build_object('user_id',r.user_id,'curriculum_id',r.curriculum_id,'dry_run',p_dry_run);
  END LOOP;
  INSERT INTO public.auto_heal_log(action_type,target_type,result_status,metadata)
  VALUES ('system_audit_repair_entitlement_drift','system',
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
    jsonb_build_object('caller_id',v_caller,'repaired',v_repaired,'rows',v_rows));
  RETURN jsonb_build_object('repaired',v_repaired,'dry_run',p_dry_run,'rows',v_rows);
END; $$;
REVOKE ALL ON FUNCTION public.admin_repair_grant_entitlement_drift(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_repair_grant_entitlement_drift(uuid,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_repair_paid_orders_without_grant(
  p_caller_id uuid DEFAULT NULL, p_dry_run boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
        SELECT id FROM auth.users WHERE email LIKE '%@examfit-smoke.local')
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
END; $$;
REVOKE ALL ON FUNCTION public.admin_repair_paid_orders_without_grant(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_repair_paid_orders_without_grant(uuid,boolean) TO authenticated, service_role;
