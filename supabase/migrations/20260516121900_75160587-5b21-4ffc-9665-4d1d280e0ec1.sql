-- Action Funnel pro Intent (sent → opened → reentered → action_taken → resolved)
CREATE OR REPLACE FUNCTION public.admin_get_notification_action_funnel(p_window_hours int DEFAULT 168)
RETURNS TABLE (
  intent_key        text,
  label             text,
  recovery_action   text,
  sent              bigint,
  opened            bigint,
  reentered         bigint,
  action_taken      bigint,
  resolved          bigint,
  open_rate         numeric,
  action_rate       numeric,
  resolution_rate   numeric,
  is_dead_reminder  boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  WITH cutoff AS (SELECT now() - make_interval(hours => p_window_hours) AS since),
  sent_q AS (
    SELECT nj.kind AS intent_key, COUNT(*) AS cnt
    FROM public.notification_jobs nj, cutoff
    WHERE nj.created_at >= cutoff.since
      AND nj.state IN ('sent','delivered')
    GROUP BY nj.kind
  ),
  event_q AS (
    SELECT
      COALESCE(nj.kind, ne.metadata->>'kind') AS intent_key,
      ne.event_type,
      COUNT(*) AS cnt
    FROM public.notification_events ne
    LEFT JOIN public.notification_jobs nj ON nj.id = ne.job_id
    , cutoff
    WHERE ne.occurred_at >= cutoff.since
    GROUP BY 1, 2
  ),
  pivoted AS (
    SELECT
      intent_key,
      SUM(CASE WHEN event_type = 'notification_opened' THEN cnt ELSE 0 END) AS opened,
      SUM(CASE WHEN event_type = 'reentry_from_push' THEN cnt ELSE 0 END) AS reentered,
      SUM(CASE WHEN event_type IN ('session_started_from_notification','cta_clicked') THEN cnt ELSE 0 END) AS action_taken,
      SUM(CASE WHEN event_type = 'goal_resolved' THEN cnt ELSE 0 END) AS resolved
    FROM event_q
    WHERE intent_key IS NOT NULL
    GROUP BY intent_key
  )
  SELECT
    r.intent_key,
    r.label,
    r.recovery_action,
    COALESCE(s.cnt, 0)::bigint                      AS sent,
    COALESCE(p.opened, 0)::bigint                   AS opened,
    COALESCE(p.reentered, 0)::bigint                AS reentered,
    COALESCE(p.action_taken, 0)::bigint             AS action_taken,
    COALESCE(p.resolved, 0)::bigint                 AS resolved,
    CASE WHEN COALESCE(s.cnt,0) > 0
         THEN ROUND(100.0 * COALESCE(p.opened,0)::numeric / s.cnt, 1) ELSE 0 END AS open_rate,
    CASE WHEN COALESCE(s.cnt,0) > 0
         THEN ROUND(100.0 * COALESCE(p.action_taken,0)::numeric / s.cnt, 1) ELSE 0 END AS action_rate,
    CASE WHEN COALESCE(s.cnt,0) > 0
         THEN ROUND(100.0 * COALESCE(p.resolved,0)::numeric / s.cnt, 1) ELSE 0 END AS resolution_rate,
    (COALESCE(s.cnt,0) >= 10 AND COALESCE(p.action_taken,0) = 0) AS is_dead_reminder
  FROM public.notification_intent_registry r
  LEFT JOIN sent_q s   ON s.intent_key = r.intent_key
  LEFT JOIN pivoted p  ON p.intent_key = r.intent_key
  WHERE r.enabled = true
  ORDER BY COALESCE(s.cnt, 0) DESC, r.intent_key;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_notification_action_funnel(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_notification_action_funnel(int) TO authenticated;

-- Learner Trust-UX: aktive Intents mit Erklärung
CREATE OR REPLACE FUNCTION public.learner_get_intent_registry()
RETURNS TABLE (
  intent_key        text,
  label             text,
  description       text,
  trigger_reason    text,
  recovery_action   text,
  max_per_day       int,
  respects_quiet_hours boolean,
  respects_fatigue  boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT intent_key, label, description, trigger_reason, recovery_action,
         max_per_day, respects_quiet_hours, respects_fatigue
  FROM public.notification_intent_registry
  WHERE enabled = true
  ORDER BY label;
$$;

GRANT EXECUTE ON FUNCTION public.learner_get_intent_registry() TO authenticated;

-- Audit
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES ('track_2_1_funnel_rpcs_deployed','system','success',
        jsonb_build_object('rpcs', ARRAY['admin_get_notification_action_funnel','learner_get_intent_registry']));