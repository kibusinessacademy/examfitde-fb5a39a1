
BEGIN;

-- ============================================================
-- 1. PROBE DEFINITIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_probe_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  probe_key text NOT NULL UNIQUE,
  probe_scope text NOT NULL,
  probe_type text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  severity text NOT NULL DEFAULT 'warn',
  timeout_seconds integer NOT NULL DEFAULT 30,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_probe_definitions_scope_chk CHECK (
    probe_scope IN ('intake','production','revenue','campaigns','distribution','optimization','control','e2e')
  ),
  CONSTRAINT system_probe_definitions_type_chk CHECK (
    probe_type IN ('rpc','edge_function','db_assertion','synthetic_chain')
  ),
  CONSTRAINT system_probe_definitions_severity_chk CHECK (
    severity IN ('info','warn','critical')
  )
);

-- ============================================================
-- 2. PROBE RUNS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_probe_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'running',
  total_probes integer NOT NULL DEFAULT 0,
  passed_count integer NOT NULL DEFAULT 0,
  warned_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  critical_failed_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT system_probe_runs_status_chk CHECK (
    status IN ('running','done','failed')
  )
);

-- ============================================================
-- 3. PROBE RESULTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_probe_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  probe_run_id uuid NOT NULL REFERENCES public.system_probe_runs(id) ON DELETE CASCADE,
  probe_key text NOT NULL,
  probe_scope text NOT NULL,
  status text NOT NULL DEFAULT 'pass',
  severity text NOT NULL DEFAULT 'warn',
  latency_ms integer,
  message text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_probe_results_status_chk CHECK (
    status IN ('pass','warn','fail')
  )
);

CREATE INDEX IF NOT EXISTS idx_system_probe_results_run
  ON public.system_probe_results (probe_run_id, probe_scope, status);

-- ============================================================
-- 4. REGRESSION SNAPSHOTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_regression_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_key text NOT NULL,
  snapshot_scope text NOT NULL,
  snapshot_date date NOT NULL DEFAULT current_date,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_regression_snapshots_lookup
  ON public.system_regression_snapshots (snapshot_scope, snapshot_date DESC);

-- ============================================================
-- 5. PROBE ALERTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_probe_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  probe_key text NOT NULL,
  severity text NOT NULL DEFAULT 'warn',
  status text NOT NULL DEFAULT 'open',
  title text NOT NULL,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT system_probe_alerts_severity_chk CHECK (
    severity IN ('info','warn','critical')
  ),
  CONSTRAINT system_probe_alerts_status_chk CHECK (
    status IN ('open','resolved')
  )
);

CREATE INDEX IF NOT EXISTS idx_system_probe_alerts_status
  ON public.system_probe_alerts (status, severity, created_at DESC);

-- ============================================================
-- SEED PROBE DEFINITIONS
-- ============================================================

INSERT INTO public.system_probe_definitions (
  probe_key, probe_scope, probe_type, severity, timeout_seconds, config, expected_result
)
VALUES
  ('probe.contract_audit', 'control', 'rpc', 'critical', 20, '{"rpc":"run_system_contract_audit"}'::jsonb, '{"ok":true}'::jsonb),
  ('probe.fanout_completion_rpc', 'production', 'rpc', 'warn', 20, '{"rpc":"assert_pipeline_status_integrity"}'::jsonb, '{"ok":true}'::jsonb),
  ('probe.control_plane_snapshot', 'control', 'edge_function', 'warn', 30, '{"edge_function":"control-plane-snapshot","body":{}}'::jsonb, '{"ok":true}'::jsonb),
  ('probe.phase2_business_snapshot', 'control', 'edge_function', 'warn', 30, '{"edge_function":"control-plane-business-snapshot","body":{}}'::jsonb, '{"ok":true}'::jsonb),
  ('probe.revenue_gtm', 'revenue', 'rpc', 'warn', 20, '{"assertion":"curriculum_gtm_scores_exist"}'::jsonb, '{"min_rows":1}'::jsonb),
  ('probe.campaign_assets_exist', 'campaigns', 'db_assertion', 'warn', 15, '{"table":"campaign_assets"}'::jsonb, '{"min_rows":1}'::jsonb),
  ('probe.distribution_publications_exist', 'distribution', 'db_assertion', 'warn', 15, '{"table":"distribution_publications"}'::jsonb, '{"min_rows":1}'::jsonb),
  ('probe.optimization_scores_exist', 'optimization', 'db_assertion', 'warn', 15, '{"table":"asset_optimization_scores"}'::jsonb, '{"min_rows":1}'::jsonb),
  ('probe.e2e_golden_path', 'e2e', 'synthetic_chain', 'critical', 60, '{"checks":["contracts","campaign_assets","distribution_publications","optimization_scores"]}'::jsonb, '{"ok":true}'::jsonb)
ON CONFLICT (probe_key) DO NOTHING;

-- ============================================================
-- RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_probe_health_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_run record;
BEGIN
  SELECT *
  INTO v_last_run
  FROM public.system_probe_runs
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_last_run.id IS NULL THEN
    RETURN jsonb_build_object('has_run', false);
  END IF;

  RETURN jsonb_build_object(
    'has_run', true,
    'last_run_id', v_last_run.id,
    'status', v_last_run.status,
    'total_probes', coalesce(v_last_run.total_probes, 0),
    'passed_count', coalesce(v_last_run.passed_count, 0),
    'warned_count', coalesce(v_last_run.warned_count, 0),
    'failed_count', coalesce(v_last_run.failed_count, 0),
    'critical_failed_count', coalesce(v_last_run.critical_failed_count, 0),
    'started_at', v_last_run.started_at,
    'finished_at', v_last_run.finished_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.run_synthetic_probe_suite()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_probe_count integer;
BEGIN
  SELECT count(*)
  INTO v_probe_count
  FROM public.system_probe_definitions
  WHERE is_enabled = true;

  RETURN jsonb_build_object(
    'ok', true,
    'enabled_probe_count', v_probe_count
  );
END;
$$;

COMMIT;
