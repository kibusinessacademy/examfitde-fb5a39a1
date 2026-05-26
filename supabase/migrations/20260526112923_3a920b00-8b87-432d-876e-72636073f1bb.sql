DROP FUNCTION IF EXISTS public.admin_get_background_agent_runtime_summary();
DROP FUNCTION IF EXISTS public.admin_get_background_agent_tasks(text,text,text,boolean,int);
DROP VIEW IF EXISTS public.v_background_agent_runtime;

CREATE VIEW public.v_background_agent_runtime AS
WITH jq AS (
  SELECT
    'job_queue'::text AS source_type,
    j.id AS source_id,
    COALESCE(j.job_name, j.job_type) AS task_kind,
    CASE
      WHEN j.status = 'queued'      THEN 'pending'
      WHEN j.status = 'processing'  THEN 'running'
      WHEN j.status = 'completed'   THEN 'completed'
      WHEN j.status = 'failed'      THEN 'failed'
      WHEN j.status = 'cancelled'   THEN 'rejected'
      ELSE j.status
    END AS status,
    CASE
      WHEN j.status = 'failed'                       THEN 'high'
      WHEN COALESCE(j.attempts,0) >= 3               THEN 'medium'
      WHEN j.lane IN ('control','governance')        THEN 'medium'
      ELSE 'low'
    END AS risk_level,
    COALESCE(j.job_name, j.job_type) || ' · ' || COALESCE(j.lane,'-') AS capability_summary,
    'not_required'::text AS approval_state,
    j.cost_estimate_eur AS cost_eur,
    NULL::numeric AS budget_eur,
    0 AS artifact_count,
    COALESCE(j.completed_at, j.started_at, j.updated_at, j.created_at) AS last_event_at,
    j.created_at,
    j.package_id,
    j.locked_by AS actor,
    jsonb_build_object(
      'lane', j.lane, 'worker_pool', j.worker_pool,
      'priority', j.priority, 'attempts', j.attempts,
      'last_error', j.last_error, 'correlation_id', j.correlation_id
    ) AS meta
  FROM public.job_queue j
  WHERE j.created_at > now() - interval '14 days'
),
si AS (
  SELECT
    'system_intents'::text,
    s.id,
    s.intent_type,
    CASE
      WHEN s.consumed_at IS NOT NULL THEN 'completed'
      WHEN s.claimed_at  IS NOT NULL THEN 'running'
      ELSE 'pending'
    END,
    'low'::text,
    s.intent_type,
    'not_required'::text,
    NULL::numeric, NULL::numeric, 0,
    COALESCE(s.consumed_at, s.claimed_at, s.created_at),
    s.created_at,
    s.package_id,
    s.claimed_by,
    jsonb_build_object('source', s.source, 'priority', s.priority)
  FROM public.system_intents s
  WHERE s.created_at > now() - interval '14 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.correlation_id = s.id
    )
),
ar AS (
  SELECT
    'berufs_ki_agent_runs'::text,
    r.id,
    COALESCE((SELECT slug FROM public.berufs_ki_agents WHERE id = r.agent_id), 'agent_run'),
    CASE
      WHEN r.status::text IN ('awaiting_approval','needs_approval') THEN 'awaiting_approval'
      WHEN r.status::text IN ('completed','approved')               THEN 'completed'
      WHEN r.status::text IN ('failed','escalated')                 THEN 'failed'
      WHEN r.status::text = 'rejected'                              THEN 'rejected'
      WHEN r.status::text IN ('running','in_progress')              THEN 'running'
      ELSE 'pending'
    END,
    CASE
      WHEN r.status::text IN ('failed','escalated')                                                          THEN 'high'
      WHEN r.governance_violations IS NOT NULL
           AND jsonb_typeof(r.governance_violations) = 'array'
           AND jsonb_array_length(r.governance_violations) > 0                                               THEN 'high'
      WHEN COALESCE(r.approval_required, false)                                                              THEN 'medium'
      ELSE 'low'
    END,
    COALESCE((SELECT name FROM public.berufs_ki_agents WHERE id = r.agent_id), 'agent_run'),
    CASE
      WHEN NOT COALESCE(r.approval_required, false)              THEN 'not_required'
      WHEN r.approved_at IS NOT NULL                             THEN 'approved'
      WHEN r.status::text = 'rejected'                           THEN 'rejected'
      ELSE 'pending'
    END,
    NULL::numeric, NULL::numeric, 0,
    COALESCE(r.updated_at, r.created_at),
    r.created_at,
    NULL::uuid,
    r.user_id::text,
    jsonb_build_object(
      'confidence', r.confidence_score,
      'governance_violations', r.governance_violations,
      'duration_ms', r.duration_ms
    )
  FROM public.berufs_ki_agent_runs r
),
ra AS (
  SELECT
    'runtime_action_results'::text,
    a.id,
    a.action_key,
    CASE
      WHEN a.status = 'success'   THEN 'completed'
      WHEN a.status = 'failed'    THEN 'failed'
      WHEN a.status = 'rejected'  THEN 'rejected'
      WHEN a.status = 'simulated' THEN 'completed'
      ELSE a.status
    END,
    CASE
      WHEN a.severity IN ('critical','error') THEN 'high'
      WHEN a.severity IN ('warning','warn')   THEN 'medium'
      ELSE 'low'
    END,
    a.action_key,
    'not_required'::text,
    NULL::numeric, NULL::numeric, 0,
    COALESCE(a.completed_at, a.created_at),
    a.created_at,
    NULL::uuid,
    a.actor_uid::text,
    jsonb_build_object(
      'reason', a.reason, 'simulation_only', a.simulation_only,
      'is_rollback', a.is_rollback, 'duration_ms', a.duration_ms
    )
  FROM public.runtime_action_results a
  WHERE a.created_at > now() - interval '14 days'
),
hp AS (
  SELECT
    'heal_permanent_fix_tasks'::text,
    h.id,
    COALESCE(h.title, h.pattern_key),
    CASE
      WHEN h.status = 'completed'   THEN 'completed'
      WHEN h.status = 'rejected'    THEN 'rejected'
      WHEN h.status = 'in_progress' THEN 'running'
      ELSE 'awaiting_approval'
    END,
    CASE
      WHEN h.priority IN ('critical','high') THEN 'high'
      WHEN h.priority = 'medium'             THEN 'medium'
      ELSE 'low'
    END,
    COALESCE(h.pattern_key, 'permanent_fix'),
    CASE
      WHEN h.status = 'completed' THEN 'approved'
      WHEN h.status = 'rejected'  THEN 'rejected'
      ELSE 'pending'
    END,
    NULL::numeric, NULL::numeric, 0,
    COALESCE(h.completed_at, h.updated_at, h.created_at),
    h.created_at,
    h.package_id,
    h.assigned_to::text,
    jsonb_build_object('cluster', h.cluster, 'priority', h.priority)
  FROM public.heal_permanent_fix_tasks h
)
SELECT * FROM jq
UNION ALL SELECT * FROM si
UNION ALL SELECT * FROM ar
UNION ALL SELECT * FROM ra
UNION ALL SELECT * FROM hp;

REVOKE ALL ON public.v_background_agent_runtime FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_background_agent_runtime TO service_role;

COMMENT ON VIEW public.v_background_agent_runtime IS
'P70.1 Unification Bridge SSOT (canonical shape). NO new tables; unions 5 existing sources. Admin access only via admin_get_background_agent_* RPCs. system_intents are deduped against job_queue.correlation_id.';

CREATE OR REPLACE FUNCTION public.admin_get_background_agent_runtime_summary()
RETURNS TABLE (
  source_type text, total bigint, pending bigint, running bigint,
  awaiting_approval bigint, completed bigint, failed bigint,
  high_risk bigint, last_activity timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    v.source_type,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE v.status = 'pending')::bigint,
    COUNT(*) FILTER (WHERE v.status = 'running')::bigint,
    COUNT(*) FILTER (WHERE v.approval_state = 'pending')::bigint,
    COUNT(*) FILTER (WHERE v.status = 'completed')::bigint,
    COUNT(*) FILTER (WHERE v.status IN ('failed','rejected'))::bigint,
    COUNT(*) FILTER (WHERE v.risk_level = 'high')::bigint,
    MAX(v.last_event_at)
  FROM public.v_background_agent_runtime v
  WHERE public.has_role(auth.uid(), 'admin')
  GROUP BY v.source_type
  ORDER BY v.source_type;
$$;
REVOKE ALL ON FUNCTION public.admin_get_background_agent_runtime_summary() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_get_background_agent_runtime_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_background_agent_tasks(
  _source_type text DEFAULT NULL,
  _status text DEFAULT NULL,
  _risk_level text DEFAULT NULL,
  _approval_only boolean DEFAULT false,
  _limit int DEFAULT 100
)
RETURNS SETOF public.v_background_agent_runtime
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.*
  FROM public.v_background_agent_runtime v
  WHERE public.has_role(auth.uid(), 'admin')
    AND (_source_type IS NULL OR v.source_type = _source_type)
    AND (_status      IS NULL OR v.status      = _status)
    AND (_risk_level  IS NULL OR v.risk_level  = _risk_level)
    AND (NOT _approval_only OR v.approval_state = 'pending')
  ORDER BY v.last_event_at DESC NULLS LAST
  LIMIT GREATEST(LEAST(COALESCE(_limit, 100), 500), 1);
$$;
REVOKE ALL ON FUNCTION public.admin_get_background_agent_tasks(text,text,text,boolean,int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_get_background_agent_tasks(text,text,text,boolean,int) TO authenticated, service_role;
