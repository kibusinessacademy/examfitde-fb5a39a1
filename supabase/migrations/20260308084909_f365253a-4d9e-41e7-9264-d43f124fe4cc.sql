
BEGIN;

-- 5. VIEW: active wave summary (corrected for wave_status enum)
CREATE OR REPLACE VIEW public.v_wave_ops_summary AS
SELECT
  count(*) FILTER (WHERE status IN ('draft','active','paused','seeding')) as active_waves,
  count(*) FILTER (WHERE status = 'cancelled') as blocked_waves,
  count(*) FILTER (WHERE status = 'completed') as completed_waves
FROM public.production_waves;

-- 6. VIEW: scheduler summary
CREATE OR REPLACE VIEW public.v_scheduler_summary AS
SELECT
  (SELECT count(*) FROM public.system_cron_executions WHERE status = 'running') as running_crons,
  (SELECT count(*) FROM public.system_execution_leases WHERE status = 'active') as active_leases,
  (SELECT count(*) FROM public.system_execution_leases WHERE status = 'active' AND lease_until < now()) as stale_leases,
  (SELECT count(*) FROM public.system_orphan_executions WHERE status = 'open') as open_orphans,
  (SELECT count(*) FROM public.system_cron_registry WHERE is_enabled = true) as enabled_crons;

-- 7. VIEW: contract integrity summary
CREATE OR REPLACE VIEW public.v_contract_integrity_summary AS
SELECT
  (SELECT count(*) FROM public.system_contract_registry WHERE is_active = true) as active_contracts,
  (SELECT count(*) FROM public.system_ssot_mappings WHERE is_active = true) as active_mappings,
  (SELECT count(*) FROM public.system_enum_registry) as enum_sets,
  (SELECT count(*) FROM public.system_contract_violations WHERE status = 'open') as open_violations;

-- 8. VIEW: executive decision summary
CREATE OR REPLACE VIEW public.v_executive_decision_summary AS
SELECT
  count(*) FILTER (WHERE decision_status = 'queued') as queued_decisions,
  count(*) FILTER (WHERE decision_status = 'processing') as processing_decisions,
  count(*) FILTER (WHERE decision_status = 'done') as done_decisions,
  count(*) FILTER (WHERE decision_status = 'failed') as failed_decisions
FROM public.executive_portfolio_decisions;

-- 9. UNIFIED SNAPSHOT RPC
CREATE OR REPLACE FUNCTION public.get_unified_leitstelle_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_control jsonb;
  v_business jsonb;
  v_probe jsonb;
  v_wave jsonb;
  v_scheduler jsonb;
  v_contracts jsonb;
  v_decisions jsonb;
  v_open_alerts integer := 0;
BEGIN
  SELECT to_jsonb(t) INTO v_control
  FROM public.v_latest_control_plane_snapshot t;

  SELECT to_jsonb(t) INTO v_business
  FROM public.v_latest_business_kpi t;

  SELECT to_jsonb(t) INTO v_probe
  FROM public.v_latest_probe_run t;

  SELECT to_jsonb(t) INTO v_wave
  FROM public.v_wave_ops_summary t;

  SELECT to_jsonb(t) INTO v_scheduler
  FROM public.v_scheduler_summary t;

  SELECT to_jsonb(t) INTO v_contracts
  FROM public.v_contract_integrity_summary t;

  SELECT to_jsonb(t) INTO v_decisions
  FROM public.v_executive_decision_summary t;

  SELECT count(*) INTO v_open_alerts
  FROM public.v_unified_open_alerts;

  RETURN jsonb_build_object(
    'control', coalesce(v_control, '{}'::jsonb),
    'business', coalesce(v_business, '{}'::jsonb),
    'probes', coalesce(v_probe, '{}'::jsonb),
    'waves', coalesce(v_wave, '{}'::jsonb),
    'scheduler', coalesce(v_scheduler, '{}'::jsonb),
    'contracts', coalesce(v_contracts, '{}'::jsonb),
    'decisions', coalesce(v_decisions, '{}'::jsonb),
    'open_alerts_count', v_open_alerts
  );
END;
$$;

-- 10. UNIFIED FEED RPC
CREATE OR REPLACE FUNCTION public.get_unified_leitstelle_feed(
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alerts jsonb;
  v_decisions jsonb;
  v_probe_results jsonb;
  v_cron_runs jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_alerts
  FROM (
    SELECT *
    FROM public.v_unified_open_alerts
    ORDER BY created_at DESC
    LIMIT p_limit
  ) x;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_decisions
  FROM (
    SELECT
      'executive_decision'::text as item_type,
      id,
      decision_type as title,
      reason as message,
      decision_status as status,
      priority,
      created_at
    FROM public.executive_portfolio_decisions
    ORDER BY created_at DESC
    LIMIT p_limit
  ) x;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_probe_results
  FROM (
    SELECT
      'probe_result'::text as item_type,
      id,
      probe_key as title,
      message,
      status,
      severity,
      created_at
    FROM public.system_probe_results
    ORDER BY created_at DESC
    LIMIT p_limit
  ) x;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.started_at DESC), '[]'::jsonb)
  INTO v_cron_runs
  FROM (
    SELECT
      'cron_execution'::text as item_type,
      id,
      cron_key as title,
      coalesce(error_message, 'execution finished') as message,
      status,
      duration_ms,
      started_at as created_at
    FROM public.system_cron_executions
    ORDER BY started_at DESC
    LIMIT p_limit
  ) x;

  RETURN jsonb_build_object(
    'alerts', coalesce(v_alerts, '[]'::jsonb),
    'decisions', coalesce(v_decisions, '[]'::jsonb),
    'probe_results', coalesce(v_probe_results, '[]'::jsonb),
    'cron_runs', coalesce(v_cron_runs, '[]'::jsonb)
  );
END;
$$;

COMMIT;
