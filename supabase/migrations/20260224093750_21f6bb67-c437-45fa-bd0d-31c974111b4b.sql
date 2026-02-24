
-- ══════════════════════════════════════════════════
-- Schema SSOT v3: Hash-based sync + Advisory Lock + Drift Analytics
-- ══════════════════════════════════════════════════

-- 1) Add contract_hash, updated_at, deprecated_at to schema_contracts
ALTER TABLE public.schema_contracts
  ADD COLUMN IF NOT EXISTS contract_hash text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deprecated_at timestamptz;

-- 2) Replace sync function with hash-based deterministic version + advisory lock
CREATE OR REPLACE FUNCTION public.sync_schema_contracts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_updated int := 0;
  v_deprecated int := 0;
  v_skipped int := 0;
  v_hash text;
  v_rec record;
  v_seen_keys text[] := '{}';
  v_lock_acquired boolean;
BEGIN
  -- Advisory lock to prevent parallel sync races
  SELECT pg_try_advisory_lock(hashtext('sync_schema_contracts')) INTO v_lock_acquired;
  IF NOT v_lock_acquired THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'another sync in progress');
  END IF;

  BEGIN
    -- ── Columns ──
    FOR v_rec IN
      SELECT 
        table_name || '.' || column_name AS entity,
        jsonb_build_object('data_type', data_type, 'is_nullable', is_nullable, 'column_default', column_default) AS spec
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name NOT LIKE 'pg_%'
        AND table_name NOT IN ('schema_contracts', 'schema_drift_log', 'schema_version_ledger')
      ORDER BY table_name, ordinal_position
    LOOP
      v_hash := md5(v_rec.spec::text);
      v_seen_keys := array_append(v_seen_keys, 'column:' || v_rec.entity);
      
      INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description, contract_hash, updated_at, deprecated_at)
      VALUES ('column', v_rec.entity, v_rec.spec, true, 'Auto-synced', v_hash, now(), NULL)
      ON CONFLICT (contract_type, entity_name) DO UPDATE SET
        expected_spec = EXCLUDED.expected_spec,
        contract_hash = EXCLUDED.contract_hash,
        updated_at = CASE WHEN schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash THEN now() ELSE schema_contracts.updated_at END,
        deprecated_at = NULL
      WHERE schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash
         OR schema_contracts.deprecated_at IS NOT NULL;
      
      IF FOUND THEN
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        IF v_inserted > 0 THEN v_updated := v_updated + 1; END IF;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    END LOOP;

    -- ── RPCs ──
    FOR v_rec IN
      SELECT 
        p.proname AS entity,
        jsonb_build_object('return_type', pg_get_function_result(p.oid), 'argument_types', pg_get_function_identity_arguments(p.oid), 'security', CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END) AS spec
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname NOT LIKE 'pg_%'
    LOOP
      v_hash := md5(v_rec.spec::text);
      v_seen_keys := array_append(v_seen_keys, 'rpc:' || v_rec.entity);
      INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description, contract_hash, updated_at, deprecated_at)
      VALUES ('rpc', v_rec.entity, v_rec.spec, true, 'Auto-synced', v_hash, now(), NULL)
      ON CONFLICT (contract_type, entity_name) DO UPDATE SET
        expected_spec = EXCLUDED.expected_spec, contract_hash = EXCLUDED.contract_hash,
        updated_at = CASE WHEN schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash THEN now() ELSE schema_contracts.updated_at END,
        deprecated_at = NULL
      WHERE schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash OR schema_contracts.deprecated_at IS NOT NULL;
    END LOOP;

    -- ── Tables ──
    FOR v_rec IN
      SELECT table_name AS entity FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('schema_contracts', 'schema_drift_log', 'schema_version_ledger')
    LOOP
      v_seen_keys := array_append(v_seen_keys, 'table:' || v_rec.entity);
      INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description, contract_hash, updated_at, deprecated_at)
      VALUES ('table', v_rec.entity, '{}'::jsonb, true, 'Auto-synced', md5('{}'), now(), NULL)
      ON CONFLICT (contract_type, entity_name) DO UPDATE SET deprecated_at = NULL WHERE schema_contracts.deprecated_at IS NOT NULL;
    END LOOP;

    -- ── Views ──
    FOR v_rec IN
      SELECT table_name AS entity FROM information_schema.views WHERE table_schema = 'public'
    LOOP
      v_seen_keys := array_append(v_seen_keys, 'view:' || v_rec.entity);
      INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description, contract_hash, updated_at, deprecated_at)
      VALUES ('view', v_rec.entity, '{}'::jsonb, false, 'Auto-synced', md5('{}'), now(), NULL)
      ON CONFLICT (contract_type, entity_name) DO UPDATE SET deprecated_at = NULL WHERE schema_contracts.deprecated_at IS NOT NULL;
    END LOOP;

    -- ── RLS Policies ──
    FOR v_rec IN
      SELECT tablename || '.' || policyname AS entity,
        jsonb_build_object('cmd', cmd, 'permissive', permissive, 'roles', roles) AS spec
      FROM pg_policies WHERE schemaname = 'public'
    LOOP
      v_hash := md5(v_rec.spec::text);
      v_seen_keys := array_append(v_seen_keys, 'rls_policy:' || v_rec.entity);
      INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description, contract_hash, updated_at, deprecated_at)
      VALUES ('rls_policy', v_rec.entity, v_rec.spec, false, 'Auto-synced', v_hash, now(), NULL)
      ON CONFLICT (contract_type, entity_name) DO UPDATE SET
        expected_spec = EXCLUDED.expected_spec, contract_hash = EXCLUDED.contract_hash,
        updated_at = CASE WHEN schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash THEN now() ELSE schema_contracts.updated_at END,
        deprecated_at = NULL
      WHERE schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash OR schema_contracts.deprecated_at IS NOT NULL;
    END LOOP;

    -- ── Mark contracts not in DB as deprecated ──
    UPDATE schema_contracts SET deprecated_at = now()
    WHERE deprecated_at IS NULL
      AND (contract_type || ':' || entity_name) != ALL(v_seen_keys)
      AND contract_type IN ('column', 'rpc', 'table', 'view', 'rls_policy');
    GET DIAGNOSTICS v_deprecated = ROW_COUNT;

    -- Release lock
    PERFORM pg_advisory_unlock(hashtext('sync_schema_contracts'));

    RETURN jsonb_build_object(
      'synced_at', now(),
      'updated', v_updated,
      'skipped_unchanged', v_skipped,
      'deprecated', v_deprecated,
      'status', 'ok'
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('sync_schema_contracts'));
    RAISE;
  END;
END;
$$;

-- 3) View for drift analytics (top entities, first/last seen)
CREATE OR REPLACE VIEW public.v_drift_analytics AS
SELECT
  entity_name,
  drift_type,
  is_critical,
  count(*) AS occurrence_count,
  min(detected_at) AS first_seen_at,
  max(detected_at) AS last_seen_at,
  max(resolved_at) AS last_resolved_at,
  count(*) FILTER (WHERE resolved_at IS NULL) AS unresolved_count
FROM schema_drift_log
GROUP BY entity_name, drift_type, is_critical
ORDER BY occurrence_count DESC, last_seen_at DESC;
