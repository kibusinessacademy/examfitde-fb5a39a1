
-- ══════════════════════════════════════════════════
-- Schema SSOT v2: Auto-Generate Contracts from DB
-- ══════════════════════════════════════════════════

-- RPC: Snapshot current DB state into schema_contracts
-- Replaces manual contract maintenance with DB-derived truth
CREATE OR REPLACE FUNCTION public.sync_schema_contracts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_updated int := 0;
  v_total int := 0;
  v_rec record;
BEGIN
  -- ── 1) Columns from information_schema ──
  FOR v_rec IN
    SELECT 
      table_name || '.' || column_name AS entity,
      jsonb_build_object(
        'data_type', data_type,
        'is_nullable', is_nullable,
        'column_default', column_default
      ) AS spec
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name NOT LIKE 'pg_%'
      AND table_name NOT IN ('schema_contracts', 'schema_drift_log', 'schema_version_ledger')
    ORDER BY table_name, ordinal_position
  LOOP
    INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description)
    VALUES ('column', v_rec.entity, v_rec.spec, true, 'Auto-synced from information_schema')
    ON CONFLICT (contract_type, entity_name) 
    DO UPDATE SET expected_spec = EXCLUDED.expected_spec
    RETURNING (xmax = 0) INTO v_rec; -- xmax=0 means INSERT
    IF v_rec IS NOT NULL THEN v_inserted := v_inserted + 1; END IF;
    v_total := v_total + 1;
  END LOOP;

  -- ── 2) RPCs from pg_proc ──
  FOR v_rec IN
    SELECT 
      p.proname AS entity,
      jsonb_build_object(
        'return_type', pg_get_function_result(p.oid),
        'argument_types', pg_get_function_identity_arguments(p.oid),
        'security', CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END
      ) AS spec
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname NOT LIKE 'pg_%'
  LOOP
    INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description)
    VALUES ('rpc', v_rec.entity, v_rec.spec, true, 'Auto-synced from pg_proc')
    ON CONFLICT (contract_type, entity_name)
    DO UPDATE SET expected_spec = EXCLUDED.expected_spec;
    v_total := v_total + 1;
  END LOOP;

  -- ── 3) Tables ──
  FOR v_rec IN
    SELECT table_name AS entity
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('schema_contracts', 'schema_drift_log', 'schema_version_ledger')
  LOOP
    INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description)
    VALUES ('table', v_rec.entity, '{}'::jsonb, true, 'Auto-synced from information_schema')
    ON CONFLICT (contract_type, entity_name) DO NOTHING;
    v_total := v_total + 1;
  END LOOP;

  -- ── 4) Views ──
  FOR v_rec IN
    SELECT table_name AS entity
    FROM information_schema.views
    WHERE table_schema = 'public'
  LOOP
    INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description)
    VALUES ('view', v_rec.entity, '{}'::jsonb, false, 'Auto-synced from information_schema')
    ON CONFLICT (contract_type, entity_name) DO NOTHING;
    v_total := v_total + 1;
  END LOOP;

  -- ── 5) RLS policies ──
  FOR v_rec IN
    SELECT 
      tablename || '.' || policyname AS entity,
      jsonb_build_object(
        'cmd', cmd,
        'permissive', permissive,
        'roles', roles
      ) AS spec
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description)
    VALUES ('rls_policy', v_rec.entity, v_rec.spec, false, 'Auto-synced from pg_policies')
    ON CONFLICT (contract_type, entity_name)
    DO UPDATE SET expected_spec = EXCLUDED.expected_spec;
    v_total := v_total + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'synced_at', now(),
    'total_contracts', v_total,
    'status', 'ok'
  );
END;
$$;

-- Register ledger entries for job-runner and cron-trigger
INSERT INTO public.schema_version_ledger (function_name, required_migration, verified_ok)
VALUES 
  ('job-runner', '20260224_schema_ssot_v2', false),
  ('cron-trigger', '20260224_schema_ssot_v2', false)
ON CONFLICT (function_name) DO UPDATE SET 
  required_migration = EXCLUDED.required_migration,
  updated_at = now();
