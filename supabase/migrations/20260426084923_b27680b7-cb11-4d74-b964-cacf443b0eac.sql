-- 1) Audit-Tabelle
CREATE TABLE IF NOT EXISTS public.force_run_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  action text NOT NULL,
  job_id uuid,
  package_id uuid,
  edge_function text,
  http_status int,
  error_code text,
  error_message text,
  request_payload jsonb,
  response_payload jsonb,
  duration_ms int,
  source text NOT NULL DEFAULT 'cockpit'
);
CREATE INDEX IF NOT EXISTS idx_force_run_audit_log_created ON public.force_run_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_force_run_audit_log_job ON public.force_run_audit_log (job_id);
CREATE INDEX IF NOT EXISTS idx_force_run_audit_log_pkg ON public.force_run_audit_log (package_id);
CREATE INDEX IF NOT EXISTS idx_force_run_audit_log_action ON public.force_run_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_force_run_audit_log_status ON public.force_run_audit_log (http_status);
ALTER TABLE public.force_run_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins_read_force_run_audit" ON public.force_run_audit_log;
CREATE POLICY "admins_read_force_run_audit" ON public.force_run_audit_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "admins_insert_force_run_audit" ON public.force_run_audit_log;
CREATE POLICY "admins_insert_force_run_audit" ON public.force_run_audit_log FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

-- 2) Log RPC
CREATE OR REPLACE FUNCTION public.admin_log_force_run(
  p_action text, p_job_id uuid DEFAULT NULL, p_package_id uuid DEFAULT NULL,
  p_edge_function text DEFAULT NULL, p_http_status int DEFAULT NULL,
  p_error_code text DEFAULT NULL, p_error_message text DEFAULT NULL,
  p_request_payload jsonb DEFAULT NULL, p_response_payload jsonb DEFAULT NULL,
  p_duration_ms int DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _id uuid; _uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(_uid,'admin'::app_role) THEN RAISE EXCEPTION 'access_denied'; END IF;
  INSERT INTO public.force_run_audit_log (actor_id, action, job_id, package_id, edge_function, http_status, error_code, error_message, request_payload, response_payload, duration_ms)
  VALUES (_uid, p_action, p_job_id, p_package_id, p_edge_function, p_http_status, p_error_code, p_error_message, p_request_payload, p_response_payload, p_duration_ms)
  RETURNING id INTO _id; RETURN _id;
END; $$;

-- 3) Phantom-Filter Härtung
CREATE OR REPLACE FUNCTION public.admin_recommend_queue_actions()
RETURNS TABLE(action_key text, cluster text, priority integer, risk_level text, is_safe boolean, job_count bigint, package_count bigint, title text, description text, recommended_strategy text, why_recommended text, oldest_job_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'access_denied'; END IF;
  RETURN QUERY
  WITH agg AS (
    SELECT v.cluster AS cl, v.subcluster, v.risk_level AS rl, v.recommended_strategy AS rs, v.safe_to_auto_execute AS se,
           COUNT(*) AS jc, COUNT(DISTINCT v.package_id) FILTER (WHERE v.package_id IS NOT NULL) AS pc,
           MIN(v.updated_at) AS oldest
    FROM public.v_admin_queue_job_classification v
    WHERE NOT v.is_admin_terminal
    GROUP BY v.cluster, v.subcluster, v.risk_level, v.recommended_strategy, v.safe_to_auto_execute
    HAVING COUNT(*) > 0
  )
  SELECT
    ('heal_'||lower(a.cl))::text,
    a.cl::text,
    (CASE a.rl WHEN 'SAFE' THEN 1 WHEN 'LOW' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'HIGH' THEN 4 ELSE 5 END)::int,
    a.rl::text, a.se::boolean, a.jc::bigint, a.pc::bigint,
    (a.cl||' ('||a.jc::text||' Jobs / '||a.pc::text||' Pakete)')::text,
    a.rs::text, a.rs::text,
    ('Cluster: '||a.cl||' · Risiko: '||a.rl)::text,
    a.oldest
  FROM agg a
  WHERE a.jc > 0
  ORDER BY (CASE a.rl WHEN 'SAFE' THEN 1 WHEN 'LOW' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'HIGH' THEN 4 ELSE 5 END) ASC, a.jc DESC;
END $function$;

-- 4) Live Timeline (named columns für RETURNS TABLE)
CREATE OR REPLACE FUNCTION public.admin_get_job_state_timeline(p_package_id uuid)
RETURNS TABLE(occurred_at timestamptz, event_type text, source text, step_key text, job_id uuid, job_type text, status_from text, status_to text, details jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'access_denied'; END IF;
  RETURN QUERY
  SELECT t.occurred_at, t.event_type, t.source, t.step_key, t.job_id, t.job_type, t.status_from, t.status_to, t.details
  FROM (
    SELECT g.created_at AS occurred_at, 'guardrail'::text AS event_type, 'ops_guardrail_events'::text AS source,
      (g.details->>'step_key')::text AS step_key, NULLIF(g.details->>'job_id','')::uuid AS job_id,
      (g.details->>'job_type')::text AS job_type, (g.details->>'old_status')::text AS status_from, (g.details->>'new_status')::text AS status_to,
      jsonb_build_object('guard_key', g.guard_key, 'details', g.details) AS details
    FROM public.ops_guardrail_events g
    WHERE g.details->>'package_id' = p_package_id::text
    UNION ALL
    SELECT jq.updated_at, 'job_event'::text, 'job_queue'::text, NULL::text, jq.id, jq.job_type, NULL::text, jq.status::text,
      jsonb_build_object('attempts', jq.attempts, 'last_http_status', jq.last_http_status,
        'last_error', LEFT(COALESCE(jq.last_error,''),500), 'priority', jq.priority, 'lane', jq.lane)
    FROM public.job_queue jq WHERE jq.package_id = p_package_id
    UNION ALL
    SELECT sma.created_at, 'step_finalize'::text, 'step_done_meta_audit'::text, sma.step_key, NULL::uuid, NULL::text,
      sma.prev_status, NULL::text,
      jsonb_build_object('source_fn', sma.source_fn, 'blocked', sma.blocked, 'block_reason', sma.block_reason, 'meta_ok', sma.meta_ok, 'meta_executed', sma.meta_executed)
    FROM public.step_done_meta_audit sma WHERE sma.package_id = p_package_id
  ) t
  ORDER BY t.occurred_at DESC LIMIT 200;
END; $$;

-- 5) Artifact Consistency
CREATE OR REPLACE FUNCTION public.admin_artifact_consistency_check(p_package_id uuid)
RETURNS TABLE(artifact_key text, expected_min int, actual_count int, status text, related_step text, hint text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _curr uuid; _lessons int := 0; _minichecks int := 0; _exam int := 0; _bp int := 0; _comp int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'access_denied'; END IF;
  SELECT curriculum_id INTO _curr FROM course_packages WHERE id=p_package_id;
  IF _curr IS NULL THEN RETURN; END IF;
  SELECT COUNT(*) INTO _lessons FROM lessons l JOIN competencies c ON c.id=l.competency_id JOIN learning_fields lf ON lf.id=c.learning_field_id WHERE lf.curriculum_id=_curr;
  SELECT COUNT(*) INTO _minichecks FROM minicheck_questions WHERE curriculum_id=_curr;
  SELECT COUNT(*) INTO _exam FROM exam_questions WHERE curriculum_id=_curr;
  SELECT COUNT(*) INTO _bp FROM exam_blueprints WHERE curriculum_id=_curr;
  SELECT COUNT(*) INTO _comp FROM competencies c JOIN learning_fields lf ON lf.id=c.learning_field_id WHERE lf.curriculum_id=_curr;
  RETURN QUERY VALUES
    ('lessons'::text, 1, _lessons, CASE WHEN _lessons>0 THEN 'ok' ELSE 'missing' END, 'generate_lessons'::text, 'Lessons fehlen — Step generate_lessons prüfen'::text),
    ('minicheck_questions'::text, GREATEST(_lessons,1), _minichecks, CASE WHEN _minichecks>=_lessons AND _lessons>0 THEN 'ok' WHEN _minichecks=0 THEN 'missing' ELSE 'partial' END, 'generate_lesson_minichecks', 'Erwartet ≥1 Minicheck pro Lesson'),
    ('exam_questions'::text, 30, _exam, CASE WHEN _exam>=30 THEN 'ok' WHEN _exam=0 THEN 'missing' ELSE 'partial' END, 'generate_exam_questions', 'Mindest-Pool: 30 Fragen'),
    ('exam_blueprints'::text, 1, _bp, CASE WHEN _bp>0 THEN 'ok' ELSE 'missing' END, 'generate_blueprints', 'Mind. 1 Blueprint pro Lernfeld'),
    ('competencies'::text, 1, _comp, CASE WHEN _comp>0 THEN 'ok' ELSE 'missing' END, 'enrich_competencies', 'Mind. 1 Kompetenz pro Lernfeld');
END; $$;

-- 6) 503 Diagnose
CREATE OR REPLACE FUNCTION public.admin_diagnose_503_summary(p_hours int DEFAULT 24)
RETURNS TABLE(job_type text, edge_function text, http_503_count bigint, affected_packages bigint, sample_error text, oldest_at timestamptz, newest_at timestamptz, copy_paste_summary text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'access_denied'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT jq.job_type, jq.package_id, jq.last_error, jq.updated_at, regexp_replace(jq.job_type,'^package_','') AS edge_function
    FROM public.job_queue jq
    WHERE jq.last_http_status=503 AND jq.updated_at > now() - (p_hours || ' hours')::interval
  )
  SELECT base.job_type, base.edge_function, COUNT(*)::bigint, COUNT(DISTINCT base.package_id)::bigint,
         LEFT(MAX(base.last_error),240), MIN(base.updated_at), MAX(base.updated_at),
         'HTTP 503 — '||base.job_type||' ('||COUNT(*)::text||' Treffer / '||COUNT(DISTINCT base.package_id)::text||' Pakete) | Edge: '||base.edge_function||' | Letzter Fehler: '||COALESCE(LEFT(MAX(base.last_error),120),'(leer)')
  FROM base GROUP BY base.job_type, base.edge_function
  ORDER BY COUNT(*) DESC LIMIT 30;
END; $$;

-- 7) Safe Step Reset (Healing Wizard)
CREATE OR REPLACE FUNCTION public.admin_safe_step_reset(
  p_package_id uuid, p_step_key text, p_reason text,
  p_cascade_dependent boolean DEFAULT false, p_create_fresh_job boolean DEFAULT true,
  p_job_type text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _new_job_id uuid; _result jsonb := '{}'::jsonb; _curr uuid; _affected int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'access_denied'; END IF;
  IF p_reason IS NULL OR length(p_reason)<5 THEN RAISE EXCEPTION 'reason_required: human-readable reason mandatory'; END IF;
  SELECT curriculum_id INTO _curr FROM course_packages WHERE id=p_package_id;
  UPDATE public.package_steps
  SET status='queued',
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('allow_regression',true,'allow_regression_by','admin_manual','reset_at',now(),'reset_reason',p_reason,'reset_actor',auth.uid()),
      attempts=0, last_error=NULL, finished_at=NULL, started_at=NULL
  WHERE package_id=p_package_id AND step_key=p_step_key;
  GET DIAGNOSTICS _affected = ROW_COUNT;
  _result := _result || jsonb_build_object('step_updated', _affected);
  IF p_create_fresh_job AND p_job_type IS NOT NULL THEN
    INSERT INTO public.job_queue (job_type, status, priority, payload, package_id, lane, meta)
    VALUES (p_job_type, 'pending', 900, jsonb_build_object('package_id',p_package_id,'curriculum_id',_curr),
            p_package_id, 'recovery', jsonb_build_object('created_by','admin_safe_step_reset','reason',p_reason,'actor',auth.uid()))
    RETURNING id INTO _new_job_id;
    _result := _result || jsonb_build_object('new_job_id', _new_job_id);
  END IF;
  INSERT INTO public.force_run_audit_log (actor_id, action, job_id, package_id, edge_function, request_payload)
  VALUES (auth.uid(),'safe_step_reset',_new_job_id,p_package_id,p_job_type,jsonb_build_object('step_key',p_step_key,'reason',p_reason,'cascade',p_cascade_dependent));
  RETURN _result || jsonb_build_object('ok',true,'package_id',p_package_id,'step_key',p_step_key);
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_log_force_run TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_job_state_timeline TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_artifact_consistency_check TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_diagnose_503_summary TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_safe_step_reset TO authenticated;