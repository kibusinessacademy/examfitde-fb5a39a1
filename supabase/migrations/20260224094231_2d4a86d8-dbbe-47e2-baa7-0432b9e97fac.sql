
-- 1) Fix: v_drift_analytics als security_invoker (killt Linter-Warning)
DROP VIEW IF EXISTS public.v_drift_analytics;

CREATE VIEW public.v_drift_analytics
WITH (security_invoker = true) AS
SELECT
  entity_name,
  drift_type,
  is_critical,
  count(*) AS occurrence_count,
  min(detected_at) AS first_seen_at,
  max(detected_at) AS last_seen_at,
  max(resolved_at) AS last_resolved_at,
  count(*) FILTER (WHERE resolved_at IS NULL) AS unresolved_count
FROM public.schema_drift_log
GROUP BY entity_name, drift_type, is_critical
ORDER BY occurrence_count DESC, last_seen_at DESC;

-- 2) Fix: sync_schema_contracts() – robuste Array-Init + saubere deprecated-Markierung
CREATE OR REPLACE FUNCTION public.sync_schema_contracts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seen_keys text[] := ARRAY[]::text[];
  v_hash text;
  v_key text;
  v_updated int := 0;
  v_inserted int := 0;
  v_deprecated int := 0;
  v_rec record;
  v_lock_acquired boolean;
BEGIN
  -- Advisory lock to prevent parallel syncs
  v_lock_acquired := pg_try_advisory_lock(hashtext('sync_schema_contracts'));
  IF NOT v_lock_acquired THEN
    RETURN jsonb_build_object('error', 'sync already running', 'updated', 0, 'inserted', 0, 'deprecated', 0);
  END IF;

  -- Sync columns from information_schema
  FOR v_rec IN
    SELECT 
      'column' AS contract_type,
      table_name || '.' || column_name AS entity_name,
      jsonb_build_object(
        'data_type', data_type,
        'is_nullable', is_nullable,
        'column_default', column_default
      ) AS expected
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  LOOP
    v_key := v_rec.contract_type || ':' || v_rec.entity_name;
    v_seen_keys := array_append(v_seen_keys, v_key);
    v_hash := md5(v_rec.expected::text);
    
    INSERT INTO schema_contracts (contract_type, entity_name, expected, contract_hash)
    VALUES (v_rec.contract_type, v_rec.entity_name, v_rec.expected, v_hash)
    ON CONFLICT (contract_type, entity_name) DO UPDATE
    SET expected = EXCLUDED.expected,
        contract_hash = EXCLUDED.contract_hash,
        deprecated_at = NULL,
        updated_at = now()
    WHERE schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash
       OR schema_contracts.deprecated_at IS NOT NULL;
    
    IF FOUND THEN
      GET DIAGNOSTICS v_updated = ROW_COUNT;
    END IF;
  END LOOP;

  -- Sync RPCs from pg_proc
  FOR v_rec IN
    SELECT
      'rpc' AS contract_type,
      p.proname AS entity_name,
      jsonb_build_object(
        'return_type', pg_get_function_result(p.oid),
        'arguments', pg_get_function_identity_arguments(p.oid),
        'security', CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END
      ) AS expected
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
  LOOP
    v_key := v_rec.contract_type || ':' || v_rec.entity_name;
    v_seen_keys := array_append(v_seen_keys, v_key);
    v_hash := md5(v_rec.expected::text);
    
    INSERT INTO schema_contracts (contract_type, entity_name, expected, contract_hash)
    VALUES (v_rec.contract_type, v_rec.entity_name, v_rec.expected, v_hash)
    ON CONFLICT (contract_type, entity_name) DO UPDATE
    SET expected = EXCLUDED.expected,
        contract_hash = EXCLUDED.contract_hash,
        deprecated_at = NULL,
        updated_at = now()
    WHERE schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash
       OR schema_contracts.deprecated_at IS NOT NULL;
  END LOOP;

  -- Sync tables
  FOR v_rec IN
    SELECT
      'table' AS contract_type,
      table_name AS entity_name,
      jsonb_build_object('table_type', table_type) AS expected
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    v_key := v_rec.contract_type || ':' || v_rec.entity_name;
    v_seen_keys := array_append(v_seen_keys, v_key);
    v_hash := md5(v_rec.expected::text);
    
    INSERT INTO schema_contracts (contract_type, entity_name, expected, contract_hash)
    VALUES (v_rec.contract_type, v_rec.entity_name, v_rec.expected, v_hash)
    ON CONFLICT (contract_type, entity_name) DO UPDATE
    SET expected = EXCLUDED.expected,
        contract_hash = EXCLUDED.contract_hash,
        deprecated_at = NULL,
        updated_at = now()
    WHERE schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash
       OR schema_contracts.deprecated_at IS NOT NULL;
  END LOOP;

  -- Sync views
  FOR v_rec IN
    SELECT
      'view' AS contract_type,
      table_name AS entity_name,
      jsonb_build_object('view', true) AS expected
    FROM information_schema.views
    WHERE table_schema = 'public'
  LOOP
    v_key := v_rec.contract_type || ':' || v_rec.entity_name;
    v_seen_keys := array_append(v_seen_keys, v_key);
    v_hash := md5(v_rec.expected::text);
    
    INSERT INTO schema_contracts (contract_type, entity_name, expected, contract_hash)
    VALUES (v_rec.contract_type, v_rec.entity_name, v_rec.expected, v_hash)
    ON CONFLICT (contract_type, entity_name) DO UPDATE
    SET expected = EXCLUDED.expected,
        contract_hash = EXCLUDED.contract_hash,
        deprecated_at = NULL,
        updated_at = now()
    WHERE schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash
       OR schema_contracts.deprecated_at IS NOT NULL;
  END LOOP;

  -- Sync RLS policies
  FOR v_rec IN
    SELECT
      'rls_policy' AS contract_type,
      schemaname || '.' || tablename || '.' || policyname AS entity_name,
      jsonb_build_object(
        'cmd', cmd,
        'permissive', permissive,
        'roles', roles
      ) AS expected
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    v_key := v_rec.contract_type || ':' || v_rec.entity_name;
    v_seen_keys := array_append(v_seen_keys, v_key);
    v_hash := md5(v_rec.expected::text);
    
    INSERT INTO schema_contracts (contract_type, entity_name, expected, contract_hash)
    VALUES (v_rec.contract_type, v_rec.entity_name, v_rec.expected, v_hash)
    ON CONFLICT (contract_type, entity_name) DO UPDATE
    SET expected = EXCLUDED.expected,
        contract_hash = EXCLUDED.contract_hash,
        deprecated_at = NULL,
        updated_at = now()
    WHERE schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash
       OR schema_contracts.deprecated_at IS NOT NULL;
  END LOOP;

  -- Mark contracts not seen in this sync as deprecated (robust with ANY)
  UPDATE schema_contracts
  SET deprecated_at = now()
  WHERE deprecated_at IS NULL
    AND contract_type IN ('column','rpc','table','view','rls_policy')
    AND NOT ((contract_type || ':' || entity_name) = ANY(v_seen_keys));

  GET DIAGNOSTICS v_deprecated = ROW_COUNT;

  -- Release advisory lock
  PERFORM pg_advisory_unlock(hashtext('sync_schema_contracts'));

  RETURN jsonb_build_object(
    'updated', v_updated,
    'inserted', v_inserted,
    'deprecated', v_deprecated,
    'total_seen', array_length(v_seen_keys, 1)
  );
END;
$$;
