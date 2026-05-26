
CREATE OR REPLACE VIEW public.v_background_agent_runtime AS
SELECT
  'job_queue'::text AS source,
  jq.id AS source_id,
  COALESCE(jq.job_name, jq.job_type) AS task_kind,
  jq.status AS status,
  CASE
    WHEN jq.status='failed' THEN 'error'
    WHEN jq.status='completed' THEN 'ok'
    ELSE 'info'
  END AS severity,
  false AS requires_approval,
  NULL::timestamptz AS approved_at,
  jq.created_at,
  jq.completed_at,
  jq.package_id,
  jq.locked_by AS actor,
  jq.cost_estimate_eur AS cost_eur,
  jsonb_build_object(
    'lane', jq.lane, 'worker_pool', jq.worker_pool,
    'priority', jq.priority, 'attempts', jq.attempts,
    'last_error', jq.last_error
  ) AS meta
FROM public.job_queue jq
WHERE jq.created_at > now() - interval '14 days'

UNION ALL
SELECT
  'system_intents'::text, si.id, si.intent_type,
  CASE
    WHEN si.consumed_at IS NOT NULL THEN 'completed'
    WHEN si.claimed_at  IS NOT NULL THEN 'processing'
    ELSE 'pending'
  END,
  'info'::text, false, NULL::timestamptz,
  si.created_at, si.consumed_at, si.package_id, si.claimed_by, NULL::numeric,
  jsonb_build_object('source', si.source, 'priority', si.priority)
FROM public.system_intents si
WHERE si.created_at > now() - interval '14 days'

UNION ALL
SELECT
  'berufs_ki_agent_runs'::text, ar.id,
  COALESCE((SELECT slug FROM public.berufs_ki_agents WHERE id=ar.agent_id), 'agent_run'),
  ar.status::text,
  CASE
    WHEN ar.status::text='failed' THEN 'error'
    WHEN ar.status::text IN ('escalated','rejected','awaiting_approval') THEN 'warn'
    WHEN ar.status::text='completed' THEN 'ok'
    ELSE 'info'
  END,
  COALESCE(ar.approval_required, false),
  ar.approved_at, ar.created_at,
  CASE WHEN ar.status::text IN ('completed','failed','rejected') THEN ar.updated_at END,
  NULL::uuid, ar.user_id::text, NULL::numeric,
  jsonb_build_object(
    'confidence', ar.confidence_score,
    'governance_violations', ar.governance_violations,
    'duration_ms', ar.duration_ms
  )
FROM public.berufs_ki_agent_runs ar

UNION ALL
SELECT
  'runtime_action_results'::text, ra.id, ra.action_key, ra.status,
  COALESCE(ra.severity, 'info'),
  false, NULL::timestamptz,
  ra.created_at, ra.completed_at,
  NULL::uuid, ra.actor_uid::text, NULL::numeric,
  jsonb_build_object(
    'reason', ra.reason, 'simulation_only', ra.simulation_only,
    'is_rollback', ra.is_rollback, 'duration_ms', ra.duration_ms
  )
FROM public.runtime_action_results ra
WHERE ra.created_at > now() - interval '14 days'

UNION ALL
SELECT
  'heal_permanent_fix_tasks'::text, hp.id,
  COALESCE(hp.title, hp.pattern_key), hp.status,
  CASE hp.priority WHEN 'critical' THEN 'error' WHEN 'high' THEN 'warn' ELSE 'info' END,
  true, NULL::timestamptz,
  hp.created_at, hp.completed_at, hp.package_id, hp.assigned_to::text, NULL::numeric,
  jsonb_build_object('cluster', hp.cluster, 'priority', hp.priority)
FROM public.heal_permanent_fix_tasks hp;

REVOKE ALL ON public.v_background_agent_runtime FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_background_agent_runtime TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_background_agent_runtime_summary()
RETURNS TABLE (
  source text, total bigint, pending bigint, running bigint,
  awaiting_approval bigint, completed bigint, failed bigint,
  last_activity timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT
    v.source,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE v.status IN ('pending','queued'))::bigint,
    COUNT(*) FILTER (WHERE v.status IN ('processing','running'))::bigint,
    COUNT(*) FILTER (WHERE v.status='awaiting_approval'
                      OR (v.requires_approval AND v.approved_at IS NULL AND v.completed_at IS NULL))::bigint,
    COUNT(*) FILTER (WHERE v.status IN ('completed','approved','done'))::bigint,
    COUNT(*) FILTER (WHERE v.status IN ('failed','rejected','escalated'))::bigint,
    MAX(v.created_at)
  FROM public.v_background_agent_runtime v
  WHERE public.has_role(auth.uid(), 'admin')
  GROUP BY v.source
  ORDER BY v.source;
$$;
REVOKE ALL ON FUNCTION public.admin_get_background_agent_runtime_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_background_agent_runtime_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_background_agent_tasks(
  _source text DEFAULT NULL, _status text DEFAULT NULL,
  _severity text DEFAULT NULL, _approval_only boolean DEFAULT false,
  _limit int DEFAULT 100
)
RETURNS SETOF public.v_background_agent_runtime
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT v.*
  FROM public.v_background_agent_runtime v
  WHERE public.has_role(auth.uid(), 'admin')
    AND (_source   IS NULL OR v.source   = _source)
    AND (_status   IS NULL OR v.status   = _status)
    AND (_severity IS NULL OR v.severity = _severity)
    AND (NOT _approval_only OR (v.requires_approval AND v.approved_at IS NULL AND v.completed_at IS NULL))
  ORDER BY v.created_at DESC
  LIMIT GREATEST(LEAST(COALESCE(_limit,100), 500), 1);
$$;
REVOKE ALL ON FUNCTION public.admin_get_background_agent_tasks(text,text,text,boolean,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_background_agent_tasks(text,text,text,boolean,int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_background_agent_capabilities()
RETURNS TABLE (
  registry text, key text, label text, severity text,
  requires_approval boolean, is_enabled boolean,
  allowed_roles text[], details jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT 'runtime_safe_actions'::text, rsa.action_key, rsa.label, rsa.severity,
         COALESCE(rsa.requires_second_confirm,false), COALESCE(rsa.is_enabled,true),
         rsa.allowed_roles,
         jsonb_build_object(
           'risk_level', rsa.risk_level, 'target_layer', rsa.target_layer,
           'is_destructive', rsa.is_destructive,
           'rollback_supported', rsa.rollback_supported,
           'dispatch_handler', rsa.dispatch_handler
         )
  FROM public.runtime_safe_actions rsa
  WHERE public.has_role(auth.uid(),'admin')
  UNION ALL
  SELECT 'berufs_ki_agents'::text, ba.slug, ba.name, 'info',
         COALESCE(ba.requires_human_approval,false), COALESCE(ba.is_active,false),
         NULL::text[],
         jsonb_build_object(
           'category', ba.category, 'role', ba.role,
           'allowed_tools', ba.allowed_tools,
           'allowed_workflows', ba.allowed_workflows,
           'blocked_actions', ba.blocked_actions,
           'confidence_threshold', ba.confidence_threshold
         )
  FROM public.berufs_ki_agents ba
  WHERE public.has_role(auth.uid(),'admin');
$$;
REVOKE ALL ON FUNCTION public.admin_get_background_agent_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_background_agent_capabilities() TO authenticated, service_role;

COMMENT ON VIEW public.v_background_agent_runtime IS
'Unification Bridge SSOT for background work. NO new tables — unions job_queue, system_intents, berufs_ki_agent_runs, runtime_action_results, heal_permanent_fix_tasks. Admin access only via admin_get_background_agent_* RPCs.';
