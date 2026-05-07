CREATE TABLE IF NOT EXISTS public.heal_action_registry (
  action_key   text PRIMARY KEY,
  cluster      text NOT NULL UNIQUE,
  risk_level   text NOT NULL CHECK (risk_level IN ('SAFE','LOW','MEDIUM','HIGH')),
  description  text NOT NULL,
  is_safe_auto boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.heal_action_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read heal registry" ON public.heal_action_registry;
CREATE POLICY "admins read heal registry"
ON public.heal_action_registry FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(),'admin'::app_role));

INSERT INTO public.heal_action_registry(action_key, cluster, risk_level, description, is_safe_auto) VALUES
  ('heal_stale_lock',                  'STALE_LOCK_LOOP_HARD_KILL',     'MEDIUM', 'Hard-Kill für stale processing-Loops', false),
  ('heal_repair_competency',           'REPAIR_COMPETENCY_COVERAGE',    'LOW',    'Repariert fehlende Kompetenz-Coverage', true),
  ('mark_requeue_loop_terminal',       'REQUEUE_LOOP_KILLED',           'MEDIUM', 'Markiert Endlos-Requeue-Loop als terminal', false),
  ('heal_timeout_retry',               'TIMEOUT',                       'SAFE',   'Retry für TIMEOUT-Jobs', true),
  ('heal_rate_limit_retry',            'RATE_LIMIT',                    'SAFE',   'Retry für Rate-Limit-Jobs', true),
  ('heal_network_retry',               'NETWORK_ERROR',                 'SAFE',   'Retry für Netzwerkfehler', true),
  ('heal_watchdog_retry',              'WATCHDOG_RECOVERY',             'LOW',    'Retry für Watchdog-Recovery', true),
  ('heal_unclassified_reclassifiable', 'UNCLASSIFIED_RECLASSIFIABLE',   'LOW',    'Reklassifizierung möglicher Jobs', true),
  ('heal_unclassified_transient',      'UNCLASSIFIED_TRANSIENT',        'SAFE',   'Retry transient-unklassifizierter Jobs', true)
ON CONFLICT (action_key) DO UPDATE
SET cluster=EXCLUDED.cluster,
    risk_level=EXCLUDED.risk_level,
    description=EXCLUDED.description,
    is_safe_auto=EXCLUDED.is_safe_auto;

DROP FUNCTION IF EXISTS public.admin_recommend_queue_actions();

CREATE OR REPLACE FUNCTION public.admin_recommend_queue_actions()
RETURNS TABLE(
  action_key text,
  cluster text,
  priority integer,
  risk_level text,
  is_safe boolean,
  is_executable boolean,
  job_count bigint,
  package_count bigint,
  title text,
  description text,
  recommended_strategy text,
  why_recommended text,
  oldest_job_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'access_denied'; END IF;
  RETURN QUERY
  WITH agg AS (
    SELECT v.cluster AS cl, v.risk_level AS rl, v.recommended_strategy AS rs, v.safe_to_auto_execute AS se,
           COUNT(*) AS jc, COUNT(DISTINCT v.package_id) FILTER (WHERE v.package_id IS NOT NULL) AS pc,
           MIN(v.updated_at) AS oldest
    FROM public.v_admin_queue_job_classification v
    WHERE NOT v.is_admin_terminal
    GROUP BY v.cluster, v.risk_level, v.recommended_strategy, v.safe_to_auto_execute
    HAVING COUNT(*) > 0
  )
  SELECT
    r.action_key::text,
    a.cl::text,
    (CASE r.risk_level WHEN 'SAFE' THEN 1 WHEN 'LOW' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'HIGH' THEN 4 ELSE 5 END)::int,
    r.risk_level::text,
    a.se::boolean,
    true AS is_executable,
    a.jc::bigint, a.pc::bigint,
    (a.cl||' ('||a.jc::text||' Jobs / '||a.pc::text||' Pakete)')::text,
    r.description::text,
    a.rs::text,
    ('Cluster: '||a.cl||' · Risiko: '||r.risk_level)::text,
    a.oldest
  FROM agg a
  JOIN public.heal_action_registry r ON r.cluster = a.cl
  WHERE a.jc > 0
  ORDER BY (CASE r.risk_level WHEN 'SAFE' THEN 1 WHEN 'LOW' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'HIGH' THEN 4 ELSE 5 END) ASC, a.jc DESC;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_execute_recommended_action(
  _action_key text,
  _max_jobs   integer DEFAULT 50,
  _dry_run    boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid; _result jsonb; _cluster text;
BEGIN
  _uid := auth.uid();
  IF NOT public.has_role(_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied: admin role required';
  END IF;

  IF NOT public.admin_check_action_throttle(_uid,'recommended_action_'||_action_key,10) THEN
    RAISE EXCEPTION 'rate_limit: too many recommended-action triggers (10/min)';
  END IF;

  SELECT cluster INTO _cluster
  FROM public.heal_action_registry
  WHERE action_key = _action_key;

  IF _cluster IS NULL THEN
    INSERT INTO public.auto_heal_log(action_type,target_type,result_status,result_detail,metadata)
    VALUES('unsupported_heal_action_blocked','system','blocked',
           'unknown action_key: '||_action_key,
           jsonb_build_object('action_key',_action_key,'user_id',_uid));
    RAISE EXCEPTION 'unsupported_action: % is not in heal_action_registry', _action_key;
  END IF;

  INSERT INTO public.admin_actions(action,scope,payload,user_id)
  VALUES ('execute_recommended_action','queue_health',
    jsonb_build_object('action_key',_action_key,'cluster',_cluster,'max_jobs',_max_jobs,'dry_run',_dry_run),
    _uid);

  _result := public.fn_auto_heal_cluster(_cluster,_max_jobs,_dry_run);

  RETURN jsonb_build_object('ok',true,'action_key',_action_key,'cluster',_cluster,
    'dry_run',_dry_run,'result',_result);
END $function$;