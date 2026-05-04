CREATE OR REPLACE FUNCTION public.fn_rpc_revoke_dry_run(p_batch text)
 RETURNS TABLE(function_signature text, current_grants text[], will_revoke_from text[], conflict_note text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v RECORD;
  v_oid oid;
  v_grants text[];
  v_conflict text;
BEGIN
  FOR v IN
    SELECT * FROM public.rpc_revoke_plan
     WHERE batch_name = p_batch AND status IN ('planned','dry_run_ok','error')
  LOOP
    v_conflict := NULL;
    v_grants := NULL;
    BEGIN
      v_oid := (v.function_signature)::regprocedure;
    EXCEPTION WHEN OTHERS THEN
      v_oid := NULL;
      v_conflict := 'function_not_found';
    END;

    IF v_oid IS NOT NULL THEN
      SELECT ARRAY(
        SELECT DISTINCT (aclexplode(p.proacl)).grantee::regrole::text
        FROM pg_proc p WHERE p.oid = v_oid
      ) INTO v_grants;
      IF v_grants IS NULL OR array_length(v_grants,1) IS NULL THEN
        v_conflict := 'no_acl';
      END IF;
    END IF;

    UPDATE public.rpc_revoke_plan
       SET dry_run_at = now(),
           original_grants = to_jsonb(v_grants),
           status = CASE WHEN v_conflict IS NULL THEN 'dry_run_ok' ELSE 'error' END,
           last_error = v_conflict,
           updated_at = now()
     WHERE id = v.id;

    function_signature := v.function_signature;
    current_grants := v_grants;
    will_revoke_from := v.target_roles;
    conflict_note := v_conflict;
    RETURN NEXT;
  END LOOP;

  INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES ('rpc_revoke_dry_run','batch', NULL, 'success',
          jsonb_build_object('batch', p_batch));
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_rpc_revoke_apply(p_batch text)
 RETURNS TABLE(function_signature text, status text, error text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v RECORD;
  v_role text;
  v_sql text;
  v_err text;
BEGIN
  FOR v IN
    SELECT * FROM public.rpc_revoke_plan
     WHERE batch_name = p_batch AND status = 'dry_run_ok'
  LOOP
    v_err := NULL;
    BEGIN
      FOREACH v_role IN ARRAY v.target_roles LOOP
        v_sql := format('REVOKE EXECUTE ON FUNCTION %s FROM %I',
                        v.function_signature, v_role);
        EXECUTE v_sql;
      END LOOP;

      UPDATE public.rpc_revoke_plan
         SET status = 'applied', applied_at = now(),
             last_error = NULL, updated_at = now()
       WHERE id = v.id;

      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES ('rpc_revoke_apply','rpc', NULL, 'success',
              jsonb_build_object('batch', p_batch, 'signature', v.function_signature, 'roles', v.target_roles));

      function_signature := v.function_signature; status := 'applied'; error := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      UPDATE public.rpc_revoke_plan
         SET status = 'error', last_error = v_err, updated_at = now()
       WHERE id = v.id;

      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, error_message, metadata)
      VALUES ('rpc_revoke_apply','rpc', NULL, 'error', v_err,
              jsonb_build_object('batch', p_batch, 'signature', v.function_signature));

      function_signature := v.function_signature; status := 'error'; error := v_err;
    END;
    RETURN NEXT;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_rpc_revoke_rollback(p_batch text)
 RETURNS TABLE(function_signature text, status text, error text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v RECORD;
  v_role text;
  v_err text;
BEGIN
  FOR v IN
    SELECT * FROM public.rpc_revoke_plan
     WHERE batch_name = p_batch AND status = 'applied'
  LOOP
    v_err := NULL;
    BEGIN
      IF v.original_grants IS NOT NULL THEN
        FOR v_role IN
          SELECT jsonb_array_elements_text(v.original_grants)
        LOOP
          IF v_role IN ('anon','authenticated','service_role') OR v_role = 'public' THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', v.function_signature, v_role);
          END IF;
        END LOOP;
      END IF;

      UPDATE public.rpc_revoke_plan
         SET status = 'rolled_back', rolled_back_at = now(),
             last_error = NULL, updated_at = now()
       WHERE id = v.id;

      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES ('rpc_revoke_rollback','rpc', NULL, 'success',
              jsonb_build_object('batch', p_batch, 'signature', v.function_signature));

      function_signature := v.function_signature; status := 'rolled_back'; error := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      UPDATE public.rpc_revoke_plan
         SET last_error = v_err, updated_at = now()
       WHERE id = v.id;

      function_signature := v.function_signature; status := 'error'; error := v_err;
    END;
    RETURN NEXT;
  END LOOP;
END;
$function$;