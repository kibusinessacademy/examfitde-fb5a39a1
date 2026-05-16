
-- 1) Extend allowed event types in record_notification_event
CREATE OR REPLACE FUNCTION public.record_notification_event(p_job_id uuid, p_event_type text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_job RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT user_id, kind INTO v_job
  FROM public.notification_jobs WHERE id = p_job_id;

  IF NOT FOUND OR v_job.user_id <> v_uid THEN
    RAISE EXCEPTION 'job_not_found_or_forbidden';
  END IF;

  IF p_event_type NOT IN (
    'notification_opened',
    'reentry_from_push',
    'session_started_from_notification',
    'minicheck_started_from_notification',
    'minicheck_completed_from_notification',
    'mastery_delta_post_notification',
    'readiness_recovery_post_rescue',
    'cta_clicked',
    'goal_resolved'
  ) THEN
    RAISE EXCEPTION 'invalid_event_type';
  END IF;

  INSERT INTO public.notification_events (job_id, user_id, event_type, metadata)
  VALUES (p_job_id, v_uid, p_event_type, COALESCE(p_metadata, '{}'::jsonb))
  ON CONFLICT (job_id, event_type) DO NOTHING;

  RETURN p_job_id;
END;
$function$;

-- 2) Recovery routing audit table
CREATE TABLE IF NOT EXISTS public.notification_recovery_audit (
  id BIGSERIAL PRIMARY KEY,
  source_job_id UUID NOT NULL REFERENCES public.notification_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  intent_key TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_action TEXT NOT NULL,
  created_job_id UUID,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_recovery_step UNIQUE (source_job_id, to_action)
);
CREATE INDEX IF NOT EXISTS idx_recovery_audit_user_time ON public.notification_recovery_audit(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recovery_audit_intent ON public.notification_recovery_audit(intent_key, created_at DESC);

ALTER TABLE public.notification_recovery_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recovery_audit_admin_select ON public.notification_recovery_audit;
CREATE POLICY recovery_audit_admin_select ON public.notification_recovery_audit
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

-- service_role-only writes (no policy needed; service_role bypasses RLS)

-- 3) Learner-side goal resolved RPC
CREATE OR REPLACE FUNCTION public.learner_mark_intent_resolved(p_intent_key text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_count INT := 0;
  v_job RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.notification_intent_registry WHERE intent_key = p_intent_key) THEN
    RAISE EXCEPTION 'unknown_intent';
  END IF;

  FOR v_job IN
    SELECT j.id
    FROM public.notification_jobs j
    WHERE j.user_id = v_uid
      AND j.kind = p_intent_key
      AND j.state IN ('sent','delivered')
      AND j.created_at > now() - interval '14 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_events e
        WHERE e.job_id = j.id AND e.event_type = 'goal_resolved'
      )
  LOOP
    INSERT INTO public.notification_events (job_id, user_id, event_type, metadata)
    VALUES (v_job.id, v_uid, 'goal_resolved', COALESCE(p_metadata,'{}'::jsonb))
    ON CONFLICT (job_id, event_type) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- 4) Recovery routing worker
CREATE OR REPLACE FUNCTION public.admin_run_notification_recovery_routing(p_dry_run boolean DEFAULT false)
 RETURNS TABLE(intent_key text, action text, jobs_routed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  r RECORD;
  v_inapp INT := 0; v_email INT := 0; v_esc INT := 0;
BEGIN
  IF v_actor IS NOT NULL AND NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Stage A: delivered >6h, not opened, no cta → inapp_reminder
  FOR r IN
    SELECT j.id AS src_id, j.user_id, j.kind, j.curriculum_id, j.payload
    FROM public.notification_jobs j
    JOIN public.notification_intent_registry reg ON reg.intent_key = j.kind AND reg.enabled
    WHERE j.state IN ('sent','delivered')
      AND j.delivered_at IS NOT NULL
      AND j.delivered_at < now() - interval '6 hours'
      AND j.delivered_at > now() - interval '3 days'
      AND NOT EXISTS (SELECT 1 FROM public.notification_events e WHERE e.job_id = j.id AND e.event_type IN ('notification_opened','cta_clicked','goal_resolved'))
      AND NOT EXISTS (SELECT 1 FROM public.notification_recovery_audit a WHERE a.source_job_id = j.id AND a.to_action = 'inapp_reminder')
    LIMIT 500
  LOOP
    IF NOT p_dry_run THEN
      INSERT INTO public.notification_recovery_audit(source_job_id, user_id, intent_key, from_state, to_action, reason, metadata)
      VALUES (r.src_id, r.user_id, r.kind, 'ignored_6h', 'inapp_reminder', 'no open after 6h', jsonb_build_object('payload', r.payload))
      ON CONFLICT DO NOTHING;
    END IF;
    v_inapp := v_inapp + 1;
  END LOOP;

  -- Stage B: 2+ ignored same intent in 7d → followup_email
  FOR r IN
    SELECT j.id AS src_id, j.user_id, j.kind
    FROM public.notification_jobs j
    JOIN public.notification_intent_registry reg ON reg.intent_key = j.kind AND reg.enabled
    WHERE j.state IN ('sent','delivered')
      AND j.delivered_at < now() - interval '12 hours'
      AND j.delivered_at > now() - interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM public.notification_events e WHERE e.job_id = j.id AND e.event_type IN ('notification_opened','cta_clicked','goal_resolved'))
      AND NOT EXISTS (SELECT 1 FROM public.notification_recovery_audit a WHERE a.source_job_id = j.id AND a.to_action = 'followup_email')
      AND (
        SELECT COUNT(*) FROM public.notification_jobs j2
        WHERE j2.user_id = j.user_id AND j2.kind = j.kind
          AND j2.state IN ('sent','delivered')
          AND j2.delivered_at > now() - interval '7 days'
          AND NOT EXISTS (SELECT 1 FROM public.notification_events e2 WHERE e2.job_id = j2.id AND e2.event_type IN ('notification_opened','cta_clicked','goal_resolved'))
      ) >= 2
    LIMIT 500
  LOOP
    IF NOT p_dry_run THEN
      INSERT INTO public.notification_recovery_audit(source_job_id, user_id, intent_key, from_state, to_action, reason)
      VALUES (r.src_id, r.user_id, r.kind, 'ignored_repeat', 'followup_email', '2+ ignored within 7d')
      ON CONFLICT DO NOTHING;
    END IF;
    v_email := v_email + 1;
  END LOOP;

  -- Stage C: 4+ ignored same intent in 14d → escalation signal
  FOR r IN
    SELECT j.id AS src_id, j.user_id, j.kind
    FROM public.notification_jobs j
    JOIN public.notification_intent_registry reg ON reg.intent_key = j.kind AND reg.enabled
    WHERE j.state IN ('sent','delivered')
      AND j.delivered_at < now() - interval '24 hours'
      AND j.delivered_at > now() - interval '14 days'
      AND NOT EXISTS (SELECT 1 FROM public.notification_events e WHERE e.job_id = j.id AND e.event_type IN ('notification_opened','cta_clicked','goal_resolved'))
      AND NOT EXISTS (SELECT 1 FROM public.notification_recovery_audit a WHERE a.source_job_id = j.id AND a.to_action = 'escalation')
      AND (
        SELECT COUNT(*) FROM public.notification_jobs j2
        WHERE j2.user_id = j.user_id AND j2.kind = j.kind
          AND j2.state IN ('sent','delivered')
          AND j2.delivered_at > now() - interval '14 days'
          AND NOT EXISTS (SELECT 1 FROM public.notification_events e2 WHERE e2.job_id = j2.id AND e2.event_type IN ('notification_opened','cta_clicked','goal_resolved'))
      ) >= 4
    LIMIT 500
  LOOP
    IF NOT p_dry_run THEN
      INSERT INTO public.notification_recovery_audit(source_job_id, user_id, intent_key, from_state, to_action, reason)
      VALUES (r.src_id, r.user_id, r.kind, 'ignored_chronic', 'escalation', '4+ ignored within 14d')
      ON CONFLICT DO NOTHING;
    END IF;
    v_esc := v_esc + 1;
  END LOOP;

  RETURN QUERY VALUES
    ('*'::text, 'inapp_reminder'::text, v_inapp),
    ('*'::text, 'followup_email'::text, v_email),
    ('*'::text, 'escalation'::text,     v_esc);
END;
$function$;

-- 5) Admin governance RPCs
CREATE OR REPLACE FUNCTION public.admin_set_intent_enabled(p_intent_key text, p_enabled boolean, p_reason text DEFAULT NULL)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_actor UUID := auth.uid();
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.notification_intent_registry
    SET enabled = p_enabled, updated_at = now()
    WHERE intent_key = p_intent_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_intent'; END IF;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, payload)
  VALUES ('notification_intent_toggle', 'notification_intent', NULL, 'ok',
          jsonb_build_object('intent_key', p_intent_key, 'enabled', p_enabled, 'actor', v_actor, 'reason', p_reason));
  RETURN p_enabled;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_suppression_audit(p_window_hours integer DEFAULT 168, p_limit integer DEFAULT 200)
 RETURNS TABLE(job_id uuid, intent_key text, suppression_reason text, scheduled_for timestamptz, user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT j.id, j.kind, j.suppression_reason, j.scheduled_for, j.user_id
  FROM public.notification_jobs j
  WHERE j.state = 'suppressed'
    AND j.created_at > now() - make_interval(hours => p_window_hours)
    AND public.has_role(auth.uid(), 'admin'::app_role)
  ORDER BY j.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_recovery_audit(p_window_hours integer DEFAULT 168, p_limit integer DEFAULT 200)
 RETURNS TABLE(id bigint, source_job_id uuid, intent_key text, from_state text, to_action text, reason text, created_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT a.id, a.source_job_id, a.intent_key, a.from_state, a.to_action, a.reason, a.created_at
  FROM public.notification_recovery_audit a
  WHERE a.created_at > now() - make_interval(hours => p_window_hours)
    AND public.has_role(auth.uid(), 'admin'::app_role)
  ORDER BY a.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$function$;

REVOKE ALL ON FUNCTION public.admin_set_intent_enabled(text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_intent_enabled(text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_suppression_audit(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_recovery_audit(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_run_notification_recovery_routing(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.learner_mark_intent_resolved(text, jsonb) TO authenticated;
