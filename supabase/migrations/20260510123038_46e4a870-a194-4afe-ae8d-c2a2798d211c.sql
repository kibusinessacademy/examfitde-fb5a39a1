
-- ============================================================
-- Access SSOT — Health-RPC + Drift-Heal Orchestrator
-- ============================================================

-- 1) Health-RPC (read-only, Admin/Service)
CREATE OR REPLACE FUNCTION public.admin_get_access_ssot_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_paid_total int;
  v_paid_no_grant_total int;
  v_paid_no_grant_with_items int;
  v_paid_no_grant_smoke int;
  v_grants_total int;
  v_grants_no_ent int;
  v_grants_no_ent_real int;
  v_tutor_blocked int;
  v_storage_blocked int;
  v_ents_total int;
  v_products_no_curr int;
  v_dangling_oi int;
  v_last_run record;
BEGIN
  IF v_caller IS NOT NULL AND NOT public.fn_is_admin_or_service_role(v_caller) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;

  SELECT COUNT(*) INTO v_paid_total FROM orders WHERE status='paid';

  SELECT COUNT(*) INTO v_paid_no_grant_total
  FROM orders o WHERE o.status='paid'
    AND NOT EXISTS (SELECT 1 FROM learner_course_grants g WHERE g.order_id=o.id);

  SELECT COUNT(*) INTO v_paid_no_grant_with_items
  FROM orders o WHERE o.status='paid'
    AND EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
                WHERE oi.order_id=o.id AND p.curriculum_id IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM learner_course_grants g WHERE g.order_id=o.id);

  SELECT COUNT(*) INTO v_paid_no_grant_smoke
  FROM orders o
  JOIN auth.users u ON u.id = COALESCE(o.learner_user_id, o.buyer_user_id)
  WHERE o.status='paid'
    AND u.email LIKE '%@examfit-smoke.local'
    AND NOT EXISTS (SELECT 1 FROM learner_course_grants g WHERE g.order_id=o.id);

  SELECT COUNT(*) INTO v_grants_total FROM learner_course_grants WHERE status='active';

  SELECT COUNT(*) INTO v_grants_no_ent
  FROM learner_course_grants g
  WHERE g.status='active'
    AND NOT EXISTS (SELECT 1 FROM entitlements e
                    WHERE e.user_id=g.user_id AND e.curriculum_id=g.curriculum_id);

  SELECT COUNT(*) INTO v_grants_no_ent_real
  FROM learner_course_grants g
  JOIN auth.users u ON u.id = g.user_id
  WHERE g.status='active'
    AND u.email NOT LIKE '%@examfit-smoke.local'
    AND NOT EXISTS (SELECT 1 FROM entitlements e
                    WHERE e.user_id=g.user_id AND e.curriculum_id=g.curriculum_id);

  -- Tutor/Storage Drift = grant-only Real-User ohne Bridge → würde von ALTEN Gates blockiert
  v_tutor_blocked := v_grants_no_ent_real;
  v_storage_blocked := v_grants_no_ent_real;

  SELECT COUNT(*) INTO v_ents_total FROM entitlements
   WHERE valid_until IS NULL OR valid_until > now();

  SELECT COUNT(*) INTO v_products_no_curr FROM products
   WHERE status='active' AND curriculum_id IS NULL;

  SELECT COUNT(*) INTO v_dangling_oi
  FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id
   WHERE p.id IS NULL;

  SELECT created_at, result_status, metadata INTO v_last_run
  FROM auto_heal_log
  WHERE action_type='access_ssot_drift_heal_run'
  ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'paid_orders_total', v_paid_total,
    'paid_without_grant_total', v_paid_no_grant_total,
    'paid_without_grant_with_items', v_paid_no_grant_with_items,
    'paid_without_grant_smoke', v_paid_no_grant_smoke,
    'active_grants_total', v_grants_total,
    'grants_without_entitlement_total', v_grants_no_ent,
    'grants_without_entitlement_real', v_grants_no_ent_real,
    'tutor_blocked_due_to_access_drift', v_tutor_blocked,
    'storage_blocked_due_to_access_drift', v_storage_blocked,
    'active_entitlements_total', v_ents_total,
    'products_without_curriculum_id', v_products_no_curr,
    'dangling_order_items', v_dangling_oi,
    'last_heal_run', v_last_run.created_at,
    'last_heal_status', v_last_run.result_status,
    'last_heal_metadata', v_last_run.metadata,
    'recommended_action',
      CASE
        WHEN v_paid_no_grant_with_items > 0 THEN 'run_admin_repair_paid_orders_without_grant'
        WHEN v_grants_no_ent_real > 0 THEN 'run_admin_repair_grant_entitlement_drift'
        ELSE 'healthy'
      END
  );
END
$function$;

REVOKE ALL ON FUNCTION public.admin_get_access_ssot_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_access_ssot_health() TO authenticated, service_role;

-- 2) Drift-Heal Orchestrator (mit 10-Min-Cooldown)
CREATE OR REPLACE FUNCTION public.fn_run_access_ssot_drift_heal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_last_run timestamptz;
  v_paid_res jsonb;
  v_ent_res jsonb;
  v_skipped boolean := false;
BEGIN
  -- Cooldown 10 Min (Loop-Schutz)
  SELECT MAX(created_at) INTO v_last_run
  FROM auto_heal_log
  WHERE action_type = 'access_ssot_drift_heal_run'
    AND result_status IN ('success','noop');

  IF v_last_run IS NOT NULL AND v_last_run > now() - interval '9 minutes' THEN
    INSERT INTO auto_heal_log(action_type,target_type,result_status,metadata)
    VALUES ('access_ssot_drift_heal_run','system','skipped',
            jsonb_build_object('reason','cooldown','last_run',v_last_run));
    RETURN jsonb_build_object('skipped',true,'reason','cooldown');
  END IF;

  v_paid_res := public.admin_repair_paid_orders_without_grant(NULL, false);
  v_ent_res  := public.admin_repair_grant_entitlement_drift(NULL, false);

  INSERT INTO auto_heal_log(action_type,target_type,result_status,metadata)
  VALUES ('access_ssot_drift_heal_run','system',
          CASE WHEN COALESCE((v_paid_res->>'repaired')::int,0) +
                    COALESCE((v_ent_res->>'repaired')::int,0) > 0 THEN 'success' ELSE 'noop' END,
          jsonb_build_object('paid_repair',v_paid_res,'ent_repair',v_ent_res));

  RETURN jsonb_build_object('paid',v_paid_res,'entitlements',v_ent_res);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_run_access_ssot_drift_heal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_run_access_ssot_drift_heal() TO service_role;

-- 3) Admin-Trigger-RPC (manueller "Repair Now" Button)
CREATE OR REPLACE FUNCTION public.admin_run_access_ssot_drift_heal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF NOT public.fn_is_admin_or_service_role(v_caller) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;
  RETURN public.fn_run_access_ssot_drift_heal();
END
$function$;

REVOKE ALL ON FUNCTION public.admin_run_access_ssot_drift_heal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_access_ssot_drift_heal() TO authenticated, service_role;

-- Audit
INSERT INTO public.auto_heal_log(action_type,target_type,result_status,metadata)
VALUES ('access_ssot_health_rpc_installed','system','success',
        jsonb_build_object('rpcs',jsonb_build_array(
          'admin_get_access_ssot_health','fn_run_access_ssot_drift_heal',
          'admin_run_access_ssot_drift_heal')));
