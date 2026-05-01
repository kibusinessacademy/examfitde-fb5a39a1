CREATE OR REPLACE FUNCTION public.admin_heal_next_best_action(p_limit integer DEFAULT 12)
 RETURNS TABLE(pattern_key text, cluster text, package_id uuid, package_title text, package_status text, severity_score integer, recurrence_24h integer, escalation_rate_pct numeric, blocked_reason text, package_last_error text, dominant_error text, active_recommendation_id uuid, recommendation_confidence numeric, recommendation_root_cause text, recommendation_permanent_fix text, has_active_recommendation boolean, prior_heal_attempts integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  RETURN QUERY
  SELECT v.pattern_key, v.cluster, v.package_id, v.package_title, v.package_status,
    v.severity_score::int, v.recurrence_24h::int, v.escalation_rate_pct::numeric,
    v.blocked_reason, v.package_last_error, v.dominant_error,
    v.active_recommendation_id, v.recommendation_confidence::numeric,
    v.recommendation_root_cause, v.recommendation_permanent_fix,
    (v.active_recommendation_id IS NOT NULL) AS has_active_recommendation,
    COALESCE((
      SELECT COUNT(*)::int FROM public.auto_heal_log h
      WHERE h.target_id = v.target_id AND h.created_at > now() - interval '7 days'
    ), 0) AS prior_heal_attempts
  FROM public.v_heal_recurring_patterns v
  ORDER BY v.severity_score DESC, v.escalation_rate_pct DESC, v.recurrence_24h DESC
  LIMIT GREATEST(1, LEAST(p_limit, 50));
END;
$function$;