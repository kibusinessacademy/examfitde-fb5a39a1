
CREATE OR REPLACE VIEW public.v_verwaltung_modernization_opportunities AS
WITH w AS (
  SELECT
    w.id                                AS workflow_id,
    w.department_key,
    w.workflow_key,
    w.workflow_name,
    w.category,
    COALESCE(jsonb_array_length(w.process_steps),        0) AS step_count,
    COALESCE(jsonb_array_length(w.automation_hints),     0) AS automation_hint_count,
    COALESCE(jsonb_array_length(w.escalation_triggers),  0) AS escalation_trigger_count,
    COALESCE(jsonb_array_length(w.kpi_targets),          0) AS kpi_target_count,
    COALESCE(length(w.governance_notes), 0)                 AS governance_notes_len,
    w.is_active
  FROM public.verwaltung_agent_workflows w
  WHERE w.is_active = true
),
scored AS (
  SELECT
    w.*,
    (
      (CASE WHEN automation_hint_count    > 0  THEN 30 ELSE 0 END) +
      (CASE WHEN step_count               >= 5 THEN 20 ELSE 0 END) +
      (CASE WHEN kpi_target_count         = 0  THEN 20 ELSE 0 END) +
      (CASE WHEN escalation_trigger_count > 0  THEN 15 ELSE 0 END) +
      (CASE WHEN governance_notes_len     < 40 THEN 15 ELSE 0 END)
    )::int AS opportunity_score,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN automation_hint_count    > 0  THEN 'AUTOMATION_HINT_PRESENT'   END,
      CASE WHEN step_count               >= 5 THEN 'HIGH_STEP_COUNT'           END,
      CASE WHEN kpi_target_count         = 0  THEN 'NO_KPI_TRACKING'           END,
      CASE WHEN escalation_trigger_count > 0  THEN 'ESCALATION_RISK'           END,
      CASE WHEN governance_notes_len     < 40 THEN 'GOVERNANCE_GAP'            END
    ], NULL) AS reasons
  FROM w
)
SELECT
  s.*,
  CASE
    WHEN opportunity_score >= 70 THEN 'HIGH_OPPORTUNITY'
    WHEN opportunity_score >= 40 THEN 'MEDIUM_OPPORTUNITY'
    WHEN opportunity_score >  0  THEN 'LOW_OPPORTUNITY'
    ELSE 'OK'
  END AS classification
FROM scored s;

REVOKE ALL ON public.v_verwaltung_modernization_opportunities FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_verwaltung_modernization_opportunities TO service_role;

CREATE OR REPLACE FUNCTION public.verwaltung_modernization_opportunities(
  _limit int DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text := COALESCE(auth.role(), 'anon');
  v_is_admin    boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_payload     jsonb;
BEGIN
  IF NOT (v_is_admin OR v_caller_role = 'service_role') THEN
    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
  END IF;

  WITH dept AS (
    SELECT
      department_key,
      COUNT(*)::int                                                       AS workflows_total,
      COUNT(*) FILTER (WHERE classification = 'HIGH_OPPORTUNITY')::int    AS high_count,
      COUNT(*) FILTER (WHERE classification = 'MEDIUM_OPPORTUNITY')::int  AS medium_count,
      COUNT(*) FILTER (WHERE classification = 'LOW_OPPORTUNITY')::int     AS low_count,
      COUNT(*) FILTER (WHERE classification = 'OK')::int                  AS ok_count,
      ROUND(AVG(opportunity_score)::numeric, 1)                           AS avg_score,
      MAX(opportunity_score)                                              AS max_score
    FROM public.v_verwaltung_modernization_opportunities
    GROUP BY department_key
  ),
  ranked AS (
    SELECT v.*,
           ROW_NUMBER() OVER (PARTITION BY department_key
                              ORDER BY opportunity_score DESC, workflow_key) AS rn
    FROM public.v_verwaltung_modernization_opportunities v
  ),
  top_per_dept AS (
    SELECT
      department_key,
      jsonb_agg(
        jsonb_build_object(
          'workflow_id',              workflow_id,
          'workflow_key',             workflow_key,
          'workflow_name',            workflow_name,
          'category',                 category,
          'opportunity_score',        opportunity_score,
          'classification',           classification,
          'reasons',                  reasons,
          'step_count',               step_count,
          'automation_hint_count',    automation_hint_count,
          'escalation_trigger_count', escalation_trigger_count,
          'kpi_target_count',         kpi_target_count
        ) ORDER BY opportunity_score DESC, workflow_key
      ) AS top_workflows
    FROM ranked
    WHERE rn <= 5
    GROUP BY department_key
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'totals', (
      SELECT jsonb_build_object(
        'workflows_total', COALESCE(SUM(workflows_total), 0),
        'high',            COALESCE(SUM(high_count), 0),
        'medium',          COALESCE(SUM(medium_count), 0),
        'low',             COALESCE(SUM(low_count), 0),
        'ok',              COALESCE(SUM(ok_count), 0),
        'departments',     COUNT(*)
      ) FROM dept
    ),
    'by_department', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'department_key',  d.department_key,
          'workflows_total', d.workflows_total,
          'high',            d.high_count,
          'medium',          d.medium_count,
          'low',             d.low_count,
          'ok',              d.ok_count,
          'avg_score',       d.avg_score,
          'max_score',       d.max_score,
          'top_workflows',   COALESCE(t.top_workflows, '[]'::jsonb)
        ) ORDER BY d.max_score DESC NULLS LAST, d.department_key
      )
      FROM (SELECT * FROM dept ORDER BY max_score DESC NULLS LAST, department_key LIMIT _limit) d
      LEFT JOIN top_per_dept t USING (department_key)
    ), '[]'::jsonb)
  ) INTO v_payload;

  PERFORM public.fn_emit_audit(
    _action_type   := 'verwaltung_modernization_opportunities_read',
    _target_type   := 'system',
    _result_status := 'ok',
    _payload       := jsonb_build_object('limit', _limit, 'caller_role', v_caller_role)
  );

  RETURN v_payload;
END
$$;

REVOKE ALL ON FUNCTION public.verwaltung_modernization_opportunities(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.verwaltung_modernization_opportunities(int) TO authenticated, service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES (
  'verwaltung_modernization_opportunities_read',
  ARRAY['limit','caller_role']::text[],
  'verwaltungsos.modernization'
)
ON CONFLICT (action_type) DO UPDATE
SET required_keys = EXCLUDED.required_keys,
    owner_module  = EXCLUDED.owner_module;
