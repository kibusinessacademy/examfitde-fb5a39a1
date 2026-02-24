
-- ══════════════════════════════════════════════════
-- Schema SSOT Infrastructure: Contracts + Ledger
-- ══════════════════════════════════════════════════

-- 1) Schema version ledger – tracks minimum required schema per edge function
CREATE TABLE IF NOT EXISTS public.schema_version_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL UNIQUE,
  required_migration text NOT NULL,        -- e.g. '20260224_schema_contracts'
  last_verified_at timestamptz,
  verified_ok boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schema_version_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read schema_version_ledger"
  ON public.schema_version_ledger FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role full access schema_version_ledger"
  ON public.schema_version_ledger FOR ALL
  USING (auth.role() = 'service_role');

-- 2) Schema contracts table – defines expected columns, enums, RPCs, policies
CREATE TABLE IF NOT EXISTS public.schema_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_type text NOT NULL CHECK (contract_type IN ('column', 'enum', 'rpc', 'rls_policy', 'view', 'table')),
  entity_name text NOT NULL,           -- table.column, enum_name, rpc_name, etc.
  expected_spec jsonb NOT NULL DEFAULT '{}',  -- type, params, return_type, etc.
  is_critical boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contract_type, entity_name)
);

ALTER TABLE public.schema_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read schema_contracts"
  ON public.schema_contracts FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role full access schema_contracts"
  ON public.schema_contracts FOR ALL
  USING (auth.role() = 'service_role');

-- 3) Schema drift log – records detected drifts
CREATE TABLE IF NOT EXISTS public.schema_drift_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_source text NOT NULL DEFAULT 'manual',  -- 'ci', 'cron', 'manual', 'edge_function'
  drift_type text NOT NULL,                      -- 'missing_column', 'wrong_type', 'missing_rpc', etc.
  entity_name text NOT NULL,
  expected text,
  actual text,
  is_critical boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schema_drift_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read schema_drift_log"
  ON public.schema_drift_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role full access schema_drift_log"
  ON public.schema_drift_log FOR ALL
  USING (auth.role() = 'service_role');

-- 4) RPC for drift detection – checks columns, enums, RPCs, policies
CREATE OR REPLACE FUNCTION public.check_schema_drift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_drifts jsonb := '[]'::jsonb;
  v_contract record;
  v_exists boolean;
  v_actual_type text;
BEGIN
  FOR v_contract IN 
    SELECT * FROM schema_contracts WHERE is_critical = true
  LOOP
    CASE v_contract.contract_type
      -- Column check
      WHEN 'column' THEN
        SELECT data_type INTO v_actual_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = split_part(v_contract.entity_name, '.', 1)
          AND column_name = split_part(v_contract.entity_name, '.', 2);
        
        IF v_actual_type IS NULL THEN
          v_drifts := v_drifts || jsonb_build_object(
            'type', 'missing_column',
            'entity', v_contract.entity_name,
            'expected', v_contract.expected_spec,
            'critical', v_contract.is_critical
          );
        ELSIF v_contract.expected_spec->>'data_type' IS NOT NULL 
              AND v_actual_type != v_contract.expected_spec->>'data_type' THEN
          v_drifts := v_drifts || jsonb_build_object(
            'type', 'wrong_type',
            'entity', v_contract.entity_name,
            'expected', v_contract.expected_spec->>'data_type',
            'actual', v_actual_type,
            'critical', v_contract.is_critical
          );
        END IF;

      -- Table existence check
      WHEN 'table' THEN
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = v_contract.entity_name
        ) INTO v_exists;
        
        IF NOT v_exists THEN
          v_drifts := v_drifts || jsonb_build_object(
            'type', 'missing_table',
            'entity', v_contract.entity_name,
            'critical', v_contract.is_critical
          );
        END IF;

      -- RPC check
      WHEN 'rpc' THEN
        SELECT EXISTS (
          SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON p.pronamespace = n.oid
          WHERE n.nspname = 'public' AND p.proname = v_contract.entity_name
        ) INTO v_exists;
        
        IF NOT v_exists THEN
          v_drifts := v_drifts || jsonb_build_object(
            'type', 'missing_rpc',
            'entity', v_contract.entity_name,
            'critical', v_contract.is_critical
          );
        END IF;

      -- RLS policy check
      WHEN 'rls_policy' THEN
        SELECT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = split_part(v_contract.entity_name, '.', 1)
            AND policyname = split_part(v_contract.entity_name, '.', 2)
        ) INTO v_exists;
        
        IF NOT v_exists THEN
          v_drifts := v_drifts || jsonb_build_object(
            'type', 'missing_rls_policy',
            'entity', v_contract.entity_name,
            'critical', v_contract.is_critical
          );
        END IF;

      -- View check
      WHEN 'view' THEN
        SELECT EXISTS (
          SELECT 1 FROM information_schema.views
          WHERE table_schema = 'public' AND table_name = v_contract.entity_name
        ) INTO v_exists;
        
        IF NOT v_exists THEN
          v_drifts := v_drifts || jsonb_build_object(
            'type', 'missing_view',
            'entity', v_contract.entity_name,
            'critical', v_contract.is_critical
          );
        END IF;

      ELSE NULL;
    END CASE;
  END LOOP;

  RETURN jsonb_build_object(
    'drift_count', jsonb_array_length(v_drifts),
    'critical_count', (SELECT count(*) FROM jsonb_array_elements(v_drifts) e WHERE (e->>'critical')::boolean = true),
    'checked_at', now(),
    'drifts', v_drifts
  );
END;
$$;
