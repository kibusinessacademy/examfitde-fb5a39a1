
CREATE OR REPLACE FUNCTION public.get_ops_scaling_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE v_result jsonb; v_cap record; v_active_count int; v_active_ids uuid[];
BEGIN
  SELECT * INTO v_cap FROM pipeline_capacity WHERE id = true;
  SELECT count(*) INTO v_active_count FROM pipeline_active_packages;
  SELECT array_agg(package_id) INTO v_active_ids FROM pipeline_active_packages;
  SELECT jsonb_build_object(
    'capacity', jsonb_build_object('max_wip', coalesce(v_cap.max_wip, 2), 'min_wip', coalesce(v_cap.min_wip, 1), 'current_active', v_active_count, 'active_package_ids', coalesce(to_jsonb(v_active_ids), '[]'::jsonb), 'last_decision', coalesce(v_cap.last_decision, '{}'::jsonb), 'updated_at', v_cap.updated_at),
    'jobtype_limits', (SELECT coalesce(jsonb_agg(jsonb_build_object('job_type', jl.job_type, 'max_processing', jl.max_processing)), '[]'::jsonb) FROM jobtype_limits jl),
    'recent_signals', (SELECT coalesce(jsonb_agg(jsonb_build_object('ts', s.ts, 'type', s.signal_type, 'signal', s.signal) ORDER BY s.ts DESC), '[]'::jsonb) FROM (SELECT * FROM ops_runtime_signals ORDER BY ts DESC LIMIT 10) s)
  ) INTO v_result;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.get_ops_scaling_status() FROM public;
GRANT EXECUTE ON FUNCTION public.get_ops_scaling_status() TO service_role;

CREATE OR REPLACE FUNCTION public.get_quality_dashboard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'rules', (SELECT coalesce(jsonb_agg(jsonb_build_object('rule_key', qr.rule_key, 'severity', qr.severity, 'enabled', qr.enabled, 'config', qr.config)), '[]'::jsonb) FROM quality_rules qr),
    'reports', (SELECT coalesce(jsonb_agg(jsonb_build_object('package_id', pqr.package_id, 'score', pqr.score, 'status', pqr.status, 'passed', pqr.rules_passed, 'failed', pqr.rules_failed, 'warned', pqr.rules_warned, 'created_at', pqr.created_at) ORDER BY pqr.created_at DESC), '[]'::jsonb) FROM (SELECT * FROM package_quality_reports ORDER BY created_at DESC LIMIT 50) pqr),
    'summary', jsonb_build_object('total', (SELECT count(*) FROM package_quality_reports), 'pass', (SELECT count(*) FROM package_quality_reports WHERE status = 'pass'), 'warn', (SELECT count(*) FROM package_quality_reports WHERE status = 'warn'), 'fail', (SELECT count(*) FROM package_quality_reports WHERE status = 'fail'))
  ) INTO v_result;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.get_quality_dashboard() FROM public;
GRANT EXECUTE ON FUNCTION public.get_quality_dashboard() TO service_role;

CREATE OR REPLACE FUNCTION public.get_roi_dashboard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'certifications', (SELECT coalesce(jsonb_agg(row_to_json(v)::jsonb ORDER BY v.net_profit_eur DESC), '[]'::jsonb) FROM v_roi_certification v),
    'totals', jsonb_build_object(
      'total_revenue', (SELECT coalesce(sum(amount) FILTER (WHERE event_type IN ('purchase','renewal')), 0) FROM revenue_events),
      'total_refunds', (SELECT coalesce(sum(amount) FILTER (WHERE event_type = 'refund'), 0) FROM revenue_events),
      'total_llm_cost', (SELECT coalesce(sum(cost_eur), 0) FROM llm_cost_events),
      'total_tokens', (SELECT coalesce(sum(tokens_in) + sum(tokens_out), 0) FROM llm_cost_events)
    ),
    'daily_costs', (SELECT coalesce(jsonb_agg(jsonb_build_object('date', d.dt, 'cost_eur', d.cost, 'tokens', d.tokens) ORDER BY d.dt DESC), '[]'::jsonb) FROM (SELECT ts::date AS dt, sum(cost_eur) AS cost, sum(tokens_in + tokens_out) AS tokens FROM llm_cost_events WHERE ts > now() - interval '30 days' GROUP BY 1 ORDER BY 1 DESC LIMIT 30) d)
  ) INTO v_result;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.get_roi_dashboard() FROM public;
GRANT EXECUTE ON FUNCTION public.get_roi_dashboard() TO service_role;
