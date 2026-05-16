
CREATE OR REPLACE FUNCTION public.admin_get_notification_effectiveness(p_window_hours integer DEFAULT 168)
 RETURNS TABLE(
   intent_key text,
   label text,
   channel text,
   persona text,
   sent bigint,
   opened bigint,
   cta_clicked bigint,
   resolved bigint,
   suppressed bigint,
   open_rate numeric,
   cta_rate numeric,
   resolved_rate numeric,
   ignored_rate numeric,
   suppression_rate numeric,
   dead_reminder boolean,
   recovery_inapp bigint,
   recovery_email bigint,
   recovery_escalation bigint,
   recovery_resolved bigint,
   recovery_lift_pct numeric,
   anomaly_flags text[],
   recommendation text
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_since timestamptz := now() - make_interval(hours => p_window_hours);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  WITH jobs AS (
    SELECT j.id, j.kind AS intent_key, j.channel,
           COALESCE(NULLIF(j.payload->>'persona',''), 'unknown') AS persona,
           j.state, j.suppression_reason, j.delivered_at, j.created_at
    FROM public.notification_jobs j
    WHERE j.created_at >= v_since
  ),
  evt AS (
    SELECT ne.job_id, ne.event_type
    FROM public.notification_events ne
    WHERE ne.occurred_at >= v_since
  ),
  per_job AS (
    SELECT j.intent_key, j.channel, j.persona, j.state, j.suppression_reason,
           bool_or(e.event_type = 'notification_opened')             AS was_opened,
           bool_or(e.event_type = 'cta_clicked')                     AS was_cta,
           bool_or(e.event_type = 'goal_resolved')                   AS was_resolved
    FROM jobs j LEFT JOIN evt e ON e.job_id = j.id
    GROUP BY j.id, j.intent_key, j.channel, j.persona, j.state, j.suppression_reason
  ),
  agg AS (
    SELECT
      pj.intent_key, pj.channel, pj.persona,
      COUNT(*) FILTER (WHERE pj.state IN ('sent','delivered'))           AS sent,
      COUNT(*) FILTER (WHERE pj.was_opened)                              AS opened,
      COUNT(*) FILTER (WHERE pj.was_cta)                                 AS cta_clicked,
      COUNT(*) FILTER (WHERE pj.was_resolved)                            AS resolved,
      COUNT(*) FILTER (WHERE pj.state = 'suppressed')                    AS suppressed
    FROM per_job pj
    GROUP BY pj.intent_key, pj.channel, pj.persona
  ),
  rec AS (
    SELECT a.intent_key,
           COUNT(*) FILTER (WHERE a.to_action = 'inapp_reminder')        AS r_inapp,
           COUNT(*) FILTER (WHERE a.to_action = 'followup_email')        AS r_email,
           COUNT(*) FILTER (WHERE a.to_action = 'escalation')            AS r_esc
    FROM public.notification_recovery_audit a
    WHERE a.created_at >= v_since
    GROUP BY a.intent_key
  ),
  rec_resolved AS (
    SELECT a.intent_key, COUNT(DISTINCT a.source_job_id) AS r_resolved
    FROM public.notification_recovery_audit a
    JOIN public.notification_events e
      ON e.job_id = a.source_job_id
     AND e.event_type IN ('goal_resolved','cta_clicked','notification_opened')
     AND e.occurred_at > a.created_at
    WHERE a.created_at >= v_since
    GROUP BY a.intent_key
  )
  SELECT
    a.intent_key,
    reg.label,
    a.channel,
    a.persona,
    a.sent,
    a.opened,
    a.cta_clicked,
    a.resolved,
    a.suppressed,
    CASE WHEN a.sent > 0 THEN ROUND(100.0 * a.opened     / a.sent, 1) ELSE 0 END,
    CASE WHEN a.sent > 0 THEN ROUND(100.0 * a.cta_clicked/ a.sent, 1) ELSE 0 END,
    CASE WHEN a.sent > 0 THEN ROUND(100.0 * a.resolved   / a.sent, 1) ELSE 0 END,
    CASE WHEN a.sent > 0 THEN ROUND(100.0 * (a.sent - a.opened) / a.sent, 1) ELSE 0 END,
    CASE WHEN (a.sent + a.suppressed) > 0
         THEN ROUND(100.0 * a.suppressed / (a.sent + a.suppressed), 1) ELSE 0 END,
    (a.sent >= 10 AND a.cta_clicked = 0),
    COALESCE(rec.r_inapp, 0),
    COALESCE(rec.r_email, 0),
    COALESCE(rec.r_esc, 0),
    COALESCE(rr.r_resolved, 0),
    CASE WHEN COALESCE(rec.r_inapp + rec.r_email, 0) > 0
         THEN ROUND(100.0 * COALESCE(rr.r_resolved,0) / (rec.r_inapp + rec.r_email), 1)
         ELSE 0 END,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN a.sent >= 20 AND a.opened::numeric / NULLIF(a.sent,0) < 0.15 THEN 'low_open_rate' END,
      CASE WHEN a.sent >= 20 AND (a.sent - a.opened)::numeric / NULLIF(a.sent,0) > 0.85 THEN 'high_ignored_rate' END,
      CASE WHEN a.sent >= 10 AND a.resolved::numeric / NULLIF(a.sent,0) < 0.05 THEN 'low_resolved_rate' END,
      CASE WHEN COALESCE(rec.r_esc,0) >= 3 THEN 'high_recovery_escalation' END,
      CASE WHEN (a.sent + a.suppressed) >= 20 AND a.suppressed::numeric / (a.sent + a.suppressed) > 0.7 THEN 'over_suppression' END,
      CASE WHEN a.sent >= 10 AND a.cta_clicked = 0 THEN 'dead_reminder' END
    ], NULL),
    CASE
      WHEN a.sent < 5 THEN 'Zu wenig Volumen für Bewertung'
      WHEN a.sent >= 10 AND a.cta_clicked = 0 THEN 'Intent überdenken oder pausieren (kein CTA-Click)'
      WHEN a.sent >= 20 AND a.opened::numeric / a.sent < 0.15 THEN 'Titel/Timing prüfen — sehr niedrige Open-Rate'
      WHEN COALESCE(rec.r_esc,0) >= 3 THEN 'Eskalationspfad evaluieren — chronisch ignoriert'
      WHEN a.resolved::numeric / NULLIF(a.sent,0) >= 0.4 THEN 'Hochwirksam — als Best-Practice referenzieren'
      ELSE 'Stabil — keine Maßnahme nötig'
    END
  FROM agg a
  JOIN public.notification_intent_registry reg ON reg.intent_key = a.intent_key
  LEFT JOIN rec ON rec.intent_key = a.intent_key
  LEFT JOIN rec_resolved rr ON rr.intent_key = a.intent_key
  ORDER BY a.sent DESC, a.intent_key, a.channel, a.persona;
END
$function$;

GRANT EXECUTE ON FUNCTION public.admin_get_notification_effectiveness(integer) TO authenticated;
