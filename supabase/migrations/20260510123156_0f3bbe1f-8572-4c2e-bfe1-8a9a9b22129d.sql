
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
  v_admin uuid;
BEGIN
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

  -- Stabilen Admin-Caller wählen (für die gegateten Repair-RPCs)
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role='admin' ORDER BY user_id LIMIT 1;

  v_paid_res := public.admin_repair_paid_orders_without_grant(v_admin, false);
  v_ent_res  := public.admin_repair_grant_entitlement_drift(v_admin, false);

  INSERT INTO auto_heal_log(action_type,target_type,result_status,metadata)
  VALUES ('access_ssot_drift_heal_run','system',
          CASE WHEN COALESCE((v_paid_res->>'repaired')::int,0) +
                    COALESCE((v_ent_res->>'repaired')::int,0) > 0 THEN 'success' ELSE 'noop' END,
          jsonb_build_object('paid_repair',v_paid_res,'ent_repair',v_ent_res,'caller',v_admin));

  RETURN jsonb_build_object('paid',v_paid_res,'entitlements',v_ent_res);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_run_access_ssot_drift_heal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_run_access_ssot_drift_heal() TO service_role;
