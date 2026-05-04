
-- 1) Plan-Tabelle
CREATE TABLE IF NOT EXISTS public.rpc_revoke_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_name text NOT NULL,
  function_schema text NOT NULL DEFAULT 'public',
  function_name text NOT NULL,
  function_signature text NOT NULL,             -- z.B. fn_foo(uuid, text)
  reason text,                                  -- z.B. 'internal-only', 'admin-only'
  target_roles text[] NOT NULL DEFAULT ARRAY['anon','authenticated','PUBLIC'],
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','dry_run_ok','applied','rolled_back','skipped','error')),
  original_grants jsonb,                         -- Backup der pg_proc grants (acl)
  dry_run_at timestamptz,
  applied_at timestamptz,
  rolled_back_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_name, function_signature)
);

ALTER TABLE public.rpc_revoke_plan ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_rpc_revoke_plan" ON public.rpc_revoke_plan;
CREATE POLICY "admin_read_rpc_revoke_plan" ON public.rpc_revoke_plan
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

-- 2) DRY RUN: liefert je Funktion die aktuellen Grants ohne irgendetwas zu ändern
CREATE OR REPLACE FUNCTION public.fn_rpc_revoke_dry_run(p_batch text)
RETURNS TABLE(
  function_signature text,
  current_grants text[],
  will_revoke_from text[],
  conflict_note text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_grants text[];
  v_conflict text;
BEGIN
  FOR v IN
    SELECT * FROM public.rpc_revoke_plan
     WHERE batch_name = p_batch AND status IN ('planned','dry_run_ok')
  LOOP
    -- Aktuelle Grantees aus pg_proc auslesen
    SELECT ARRAY(
      SELECT DISTINCT (aclexplode(p.proacl)).grantee::regrole::text
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = v.function_schema
        AND p.oid::regprocedure::text = v.function_schema || '.' || v.function_signature
    ) INTO v_grants;

    v_conflict := NULL;
    IF v_grants IS NULL OR array_length(v_grants,1) IS NULL THEN
      v_conflict := 'function_not_found_or_no_acl';
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
  VALUES ('rpc_revoke_dry_run','batch', p_batch, 'success',
          jsonb_build_object('batch', p_batch));
END;
$$;

-- 3) APPLY: führt Revokes aus, sichert ACL, loggt Audit
CREATE OR REPLACE FUNCTION public.fn_rpc_revoke_apply(p_batch text)
RETURNS TABLE(function_signature text, status text, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        v_sql := format('REVOKE EXECUTE ON FUNCTION %I.%s FROM %s',
                        v.function_schema, v.function_signature, v_role);
        EXECUTE v_sql;
      END LOOP;

      UPDATE public.rpc_revoke_plan
         SET status = 'applied', applied_at = now(),
             last_error = NULL, updated_at = now()
       WHERE id = v.id;

      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES ('rpc_revoke_apply','rpc', v.function_signature, 'success',
              jsonb_build_object('batch', p_batch, 'roles', v.target_roles));

      function_signature := v.function_signature; status := 'applied'; error := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      UPDATE public.rpc_revoke_plan
         SET status = 'error', last_error = v_err, updated_at = now()
       WHERE id = v.id;

      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, error_message, metadata)
      VALUES ('rpc_revoke_apply','rpc', v.function_signature, 'error', v_err,
              jsonb_build_object('batch', p_batch));

      function_signature := v.function_signature; status := 'error'; error := v_err;
    END;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 4) ROLLBACK: stellt Originalgrants aus original_grants wieder her
CREATE OR REPLACE FUNCTION public.fn_rpc_revoke_rollback(p_batch text)
RETURNS TABLE(function_signature text, status text, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_role text;
  v_sql text;
  v_err text;
  v_original_roles text[];
BEGIN
  FOR v IN
    SELECT * FROM public.rpc_revoke_plan
     WHERE batch_name = p_batch AND status = 'applied'
  LOOP
    v_err := NULL;
    BEGIN
      v_original_roles := ARRAY(SELECT jsonb_array_elements_text(v.original_grants));
      FOREACH v_role IN ARRAY v_original_roles LOOP
        IF v_role = '-' OR v_role IS NULL OR v_role = '' THEN CONTINUE; END IF;
        v_sql := format('GRANT EXECUTE ON FUNCTION %I.%s TO %s',
                        v.function_schema, v.function_signature, v_role);
        EXECUTE v_sql;
      END LOOP;

      UPDATE public.rpc_revoke_plan
         SET status = 'rolled_back', rolled_back_at = now(),
             last_error = NULL, updated_at = now()
       WHERE id = v.id;

      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES ('rpc_revoke_rollback','rpc', v.function_signature, 'success',
              jsonb_build_object('batch', p_batch, 'restored_roles', v_original_roles));

      function_signature := v.function_signature; status := 'rolled_back'; error := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      UPDATE public.rpc_revoke_plan
         SET last_error = v_err, updated_at = now()
       WHERE id = v.id;

      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, error_message, metadata)
      VALUES ('rpc_revoke_rollback','rpc', v.function_signature, 'error', v_err,
              jsonb_build_object('batch', p_batch));

      function_signature := v.function_signature; status := 'error'; error := v_err;
    END;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_rpc_revoke_dry_run(text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_rpc_revoke_apply(text)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_rpc_revoke_rollback(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rpc_revoke_dry_run(text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_rpc_revoke_apply(text)    TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_rpc_revoke_rollback(text) TO service_role;
