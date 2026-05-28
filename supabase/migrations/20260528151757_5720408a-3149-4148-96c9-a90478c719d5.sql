
CREATE OR REPLACE VIEW public.v_verwaltung_governance_audit AS
SELECT
  l.id, l.created_at, l.action_type, l.result_status, l.trigger_source,
  l.target_id, l.target_type, l.error_message, l.duration_ms, l.metadata,
  CASE
    WHEN l.action_type ILIKE 'verwaltung%' THEN 'verwaltung_native'
    WHEN l.action_type ILIKE '%tutor%' THEN 'tutor_governance'
    WHEN l.action_type ILIKE '%refusal%' THEN 'refusal_event'
    ELSE 'general'
  END AS audit_category
FROM public.auto_heal_log l
WHERE l.action_type ILIKE 'verwaltung%'
   OR l.target_type IN ('verwaltung_oral_session','verwaltung_workflow','verwaltung_agent')
   OR (l.metadata ? 'department_key');

REVOKE ALL ON public.v_verwaltung_governance_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_verwaltung_governance_audit TO service_role;

CREATE OR REPLACE FUNCTION public.verwaltung_governance_audit_trail(
  _window_days integer DEFAULT 7, _limit integer DEFAULT 200
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text := auth.role();
  v_uid uuid := auth.uid();
  v_summary jsonb; v_recent jsonb;
BEGIN
  IF v_role <> 'service_role' AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH evt AS (
    SELECT * FROM public.v_verwaltung_governance_audit
    WHERE created_at > now() - make_interval(days => _window_days)
  ),
  cat AS (SELECT audit_category, count(*)::int AS c FROM evt GROUP BY audit_category),
  st AS (SELECT result_status, count(*)::int AS c FROM evt GROUP BY result_status)
  SELECT jsonb_build_object(
    'window_days', _window_days,
    'total_events', (SELECT count(*)::int FROM evt),
    'by_category', COALESCE((SELECT jsonb_object_agg(audit_category, c) FROM cat), '{}'::jsonb),
    'by_status', COALESCE((SELECT jsonb_object_agg(result_status, c) FROM st WHERE result_status IS NOT NULL), '{}'::jsonb)
  ) INTO v_summary;

  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT id, created_at, action_type, audit_category, result_status,
           trigger_source, target_id, target_type, error_message, duration_ms, metadata
    FROM public.v_verwaltung_governance_audit
    WHERE created_at > now() - make_interval(days => _window_days)
    ORDER BY created_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 1000))
  ) r;

  PERFORM public.fn_emit_audit(
    'verwaltung_governance_audit_trail_read', NULL, 'system',
    jsonb_build_object('window_days', _window_days, 'caller_role', v_role)
  );

  RETURN jsonb_build_object('summary', v_summary, 'recent', v_recent, 'generated_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.verwaltung_governance_audit_trail(integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verwaltung_governance_audit_trail(integer,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verwaltung_governance_refusal_quality(
  _window_days integer DEFAULT 14
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text := auth.role();
  v_uid uuid := auth.uid();
  v_payload jsonb;
BEGIN
  IF v_role <> 'service_role' AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH base AS (
    SELECT s.department_key, t.role, t.evaluation, t.content,
      (t.role='system'
       OR (t.evaluation ? 'refusal')
       OR t.content ILIKE 'Ich kann diese Frage nicht%'
       OR t.content ILIKE '%verweigere die Antwort%'
       OR t.content ILIKE '%nicht zuständig%') AS is_refusal
    FROM public.verwaltung_oral_turns t
    JOIN public.verwaltung_oral_sessions s ON s.id = t.session_id
    WHERE t.created_at > now() - make_interval(days => _window_days)
  ),
  per_dept AS (
    SELECT department_key,
      count(*)::int AS total_turns,
      count(*) FILTER (WHERE is_refusal)::int AS refusal_turns,
      count(*) FILTER (WHERE is_refusal AND evaluation ? 'refusal_quality_ok')::int AS refusal_qualified
    FROM base GROUP BY department_key
  )
  SELECT jsonb_build_object(
    'window_days', _window_days,
    'totals', jsonb_build_object(
      'turns', COALESCE((SELECT sum(total_turns) FROM per_dept), 0),
      'refusals', COALESCE((SELECT sum(refusal_turns) FROM per_dept), 0),
      'refusals_qualified', COALESCE((SELECT sum(refusal_qualified) FROM per_dept), 0)
    ),
    'by_department', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'department_key', department_key,
      'total_turns', total_turns,
      'refusal_turns', refusal_turns,
      'refusal_qualified', refusal_qualified,
      'refusal_rate', CASE WHEN total_turns>0 THEN round((refusal_turns::numeric/total_turns)*100,1) ELSE 0 END,
      'qualified_rate', CASE WHEN refusal_turns>0 THEN round((refusal_qualified::numeric/refusal_turns)*100,1) ELSE 0 END,
      'classification', CASE
        WHEN total_turns=0 THEN 'NO_DATA'
        WHEN refusal_turns=0 THEN 'NO_REFUSALS'
        WHEN refusal_turns::numeric/total_turns > 0.4 THEN 'OVER_REFUSING'
        WHEN refusal_qualified::numeric/NULLIF(refusal_turns,0) < 0.5 THEN 'LOW_QUALITY_REFUSALS'
        ELSE 'OK' END
    ) ORDER BY refusal_turns DESC) FROM per_dept), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_payload;

  PERFORM public.fn_emit_audit(
    'verwaltung_governance_refusal_quality_read', NULL, 'system',
    jsonb_build_object('window_days', _window_days, 'caller_role', v_role)
  );
  RETURN v_payload;
END; $$;

REVOKE ALL ON FUNCTION public.verwaltung_governance_refusal_quality(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verwaltung_governance_refusal_quality(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verwaltung_governance_source_coverage(
  _window_days integer DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text := auth.role();
  v_uid uuid := auth.uid();
  v_payload jsonb;
BEGIN
  IF v_role <> 'service_role' AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH dept_activity AS (
    SELECT department_key, count(*)::int AS session_count, max(started_at) AS last_session_at
    FROM public.verwaltung_oral_sessions
    WHERE started_at > now() - make_interval(days => _window_days)
    GROUP BY department_key
  ),
  wc AS (
    SELECT w.department_key, w.workflow_key, w.workflow_name, w.category,
      COALESCE(jsonb_array_length(w.kpi_targets), 0) AS kpi_count,
      COALESCE(jsonb_array_length(w.escalation_triggers), 0) AS escalation_count,
      COALESCE(jsonb_array_length(w.automation_hints), 0) AS automation_count,
      COALESCE(da.session_count, 0) AS session_count, da.last_session_at,
      CASE
        WHEN COALESCE(da.session_count,0)=0 AND COALESCE(jsonb_array_length(w.kpi_targets),0)>0 THEN 'DEAD_WORKFLOW'
        WHEN COALESCE(da.session_count,0)=0 THEN 'NO_ACTIVITY'
        WHEN COALESCE(jsonb_array_length(w.kpi_targets),0)=0
          AND COALESCE(jsonb_array_length(w.escalation_triggers),0)=0 THEN 'METADATA_GAP'
        ELSE 'COVERED'
      END AS coverage_status
    FROM public.verwaltung_agent_workflows w
    LEFT JOIN dept_activity da ON da.department_key = w.department_key
    WHERE w.is_active
  )
  SELECT jsonb_build_object(
    'window_days', _window_days,
    'totals', jsonb_build_object(
      'workflows', (SELECT count(*)::int FROM wc),
      'covered', (SELECT count(*)::int FROM wc WHERE coverage_status='COVERED'),
      'dead', (SELECT count(*)::int FROM wc WHERE coverage_status='DEAD_WORKFLOW'),
      'no_activity', (SELECT count(*)::int FROM wc WHERE coverage_status='NO_ACTIVITY'),
      'metadata_gap', (SELECT count(*)::int FROM wc WHERE coverage_status='METADATA_GAP')
    ),
    'dead_workflows', COALESCE((SELECT jsonb_agg(row_to_json(d)) FROM (
      SELECT department_key, workflow_key, workflow_name, category,
             kpi_count, escalation_count, automation_count, coverage_status
      FROM wc WHERE coverage_status IN ('DEAD_WORKFLOW','METADATA_GAP')
      ORDER BY (coverage_status='DEAD_WORKFLOW') DESC, kpi_count DESC
      LIMIT 50
    ) d), '[]'::jsonb),
    'by_department', COALESCE((SELECT jsonb_agg(row_to_json(b)) FROM (
      SELECT department_key,
             count(*)::int AS workflow_count,
             count(*) FILTER (WHERE coverage_status='COVERED')::int AS covered_count,
             count(*) FILTER (WHERE coverage_status='DEAD_WORKFLOW')::int AS dead_count,
             count(*) FILTER (WHERE coverage_status='NO_ACTIVITY')::int AS no_activity_count,
             count(*) FILTER (WHERE coverage_status='METADATA_GAP')::int AS metadata_gap_count
      FROM wc GROUP BY department_key
      ORDER BY dead_count DESC, workflow_count DESC
    ) b), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_payload;

  PERFORM public.fn_emit_audit(
    'verwaltung_governance_source_coverage_read', NULL, 'system',
    jsonb_build_object('window_days', _window_days, 'caller_role', v_role)
  );
  RETURN v_payload;
END; $$;

REVOKE ALL ON FUNCTION public.verwaltung_governance_source_coverage(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verwaltung_governance_source_coverage(integer) TO authenticated, service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module) VALUES
  ('verwaltung_governance_audit_trail_read', ARRAY['window_days','caller_role'], 'verwaltungsos.governance'),
  ('verwaltung_governance_refusal_quality_read', ARRAY['window_days','caller_role'], 'verwaltungsos.governance'),
  ('verwaltung_governance_source_coverage_read', ARRAY['window_days','caller_role'], 'verwaltungsos.governance')
ON CONFLICT (action_type) DO NOTHING;
