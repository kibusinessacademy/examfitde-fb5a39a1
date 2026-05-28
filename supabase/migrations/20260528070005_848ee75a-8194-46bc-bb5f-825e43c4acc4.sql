
CREATE OR REPLACE FUNCTION public.verwaltung_daily_brief_workflow_pressure(
  _window_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text := COALESCE(auth.role(),'');
  v_result jsonb;
BEGIN
  IF v_role <> 'service_role'
     AND (v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  IF _window_days IS NULL OR _window_days < 1 OR _window_days > 90 THEN
    _window_days := 7;
  END IF;

  WITH oral AS (
    SELECT department_key,
      COUNT(*) FILTER (WHERE started_at >= now() - make_interval(days => _window_days)) AS sessions_in_window,
      ROUND(AVG(escalation_state) FILTER (WHERE started_at >= now() - make_interval(days => _window_days)), 2) AS avg_escalation,
      ROUND(100.0 * COUNT(*) FILTER (WHERE escalation_state >= 3 AND started_at >= now() - make_interval(days => _window_days))::numeric
        / NULLIF(COUNT(*) FILTER (WHERE started_at >= now() - make_interval(days => _window_days)),0)::numeric, 1) AS high_conflict_pct
    FROM public.verwaltung_oral_sessions GROUP BY department_key
  ),
  joined AS (
    SELECT d.department_key, d.display_name,
      COALESCE(ws.workflow_count, 0) AS workflow_count,
      COALESCE(ws.pct_with_escalations, 0) AS pct_with_escalations,
      COALESCE(ws.pct_with_automation, 0) AS pct_with_automation,
      COALESCE(ws.pct_with_kpis, 0) AS pct_with_kpis,
      COALESCE(ws.total_escalation_triggers, 0) AS total_escalation_triggers,
      COALESCE(ws.total_automation_hints, 0) AS total_automation_hints,
      COALESCE(o.sessions_in_window, 0) AS sessions_in_window,
      COALESCE(o.avg_escalation, 0) AS avg_escalation,
      COALESCE(o.high_conflict_pct, 0) AS high_conflict_pct
    FROM public.verwaltung_department_dna d
    LEFT JOIN public.v_verwaltung_workflow_signals ws ON ws.department_key = d.department_key
    LEFT JOIN oral o ON o.department_key = d.department_key
  ),
  classified AS (
    SELECT j.*,
      CASE
        WHEN j.workflow_count = 0 THEN 'GOVERNANCE_GAP'
        WHEN j.avg_escalation >= 2.5 AND j.pct_with_escalations >= 50 THEN 'WORKFLOW_PRESSURE'
        WHEN j.pct_with_automation <= 30 AND j.workflow_count >= 3 THEN 'AUTOMATION_OPPORTUNITY'
        WHEN j.pct_with_kpis <= 50 AND j.workflow_count >= 3 THEN 'GOVERNANCE_GAP'
        ELSE 'OK'
      END AS classification,
      LEAST(100, GREATEST(0,
        (j.avg_escalation * 15)::int + (j.high_conflict_pct * 0.3)::int + (j.pct_with_escalations * 0.3)::int
        - (j.pct_with_automation * 0.2)::int - (j.pct_with_kpis * 0.1)::int
      ))::int AS pressure_score
    FROM joined j
  )
  SELECT jsonb_build_object(
    'window_days', _window_days,
    'generated_at', now(),
    'department_count', (SELECT COUNT(*) FROM classified),
    'pressure_avg', (SELECT ROUND(AVG(pressure_score)::numeric, 1) FROM classified),
    'classification_mix', (SELECT jsonb_object_agg(classification, cnt) FROM (SELECT classification, COUNT(*) AS cnt FROM classified GROUP BY classification) m),
    'top_pressure', (
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT c.department_key, c.display_name, c.classification, c.pressure_score,
          c.workflow_count, c.pct_with_escalations, c.pct_with_automation, c.pct_with_kpis,
          c.avg_escalation, c.high_conflict_pct, c.sessions_in_window,
          (SELECT jsonb_agg(jsonb_build_object(
              'workflow_key', wf.workflow_key, 'workflow_name', wf.workflow_name, 'category', wf.category,
              'escalation_count', jsonb_array_length(COALESCE(wf.escalation_triggers,'[]'::jsonb)),
              'automation_count', jsonb_array_length(COALESCE(wf.automation_hints,'[]'::jsonb)),
              'kpi_count', jsonb_array_length(COALESCE(wf.kpi_targets,'[]'::jsonb))))
           FROM (SELECT * FROM public.verwaltung_agent_workflows
                 WHERE department_key = c.department_key AND is_active = true
                 ORDER BY jsonb_array_length(COALESCE(escalation_triggers,'[]'::jsonb)) DESC,
                          jsonb_array_length(COALESCE(automation_hints,'[]'::jsonb)) ASC LIMIT 3) wf
          ) AS top_workflows
        FROM classified c ORDER BY c.pressure_score DESC, c.department_key LIMIT 12
      ) t
    ),
    'departments', (SELECT jsonb_agg(row_to_json(c) ORDER BY department_key) FROM classified c)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verwaltung_daily_brief_workflow_pressure(integer) TO authenticated, service_role;
