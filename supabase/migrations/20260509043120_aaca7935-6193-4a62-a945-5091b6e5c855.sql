-- S3 Migration 3: Auto-Pulse Impact Measurement (Track C)

-- View: per pulse-decision, paired with the closest follow-up snapshot ~30 min later
CREATE OR REPLACE VIEW public.v_auto_pulse_impact_30m AS
WITH pulses AS (
  SELECT
    l.id, l.created_at,
    (l.metadata->>'decision') AS decision,
    NULLIF(l.metadata->>'pending','')::numeric AS before_pending,
    NULLIF(l.metadata->>'oldest_min','')::numeric AS before_oldest_min,
    NULLIF(l.metadata->>'burst_size','')::numeric AS burst_size,
    NULLIF(l.metadata->>'pulsed','')::numeric AS pulsed_jobs,
    NULLIF(l.metadata#>>'{gate,db_latency_ms}','')::numeric AS before_db_latency_ms,
    NULLIF(l.metadata#>>'{gate,reaper_kills_5m}','')::numeric AS before_reaper_kills,
    NULLIF(l.metadata->>'failure_rate_15m','')::numeric AS before_failure_rate
  FROM public.auto_heal_log l
  WHERE l.action_type = 'auto_recovery_pulse_decide'
    AND l.created_at >= now() - interval '7 days'
)
SELECT
  p.id, p.created_at, p.decision,
  p.before_pending, p.before_oldest_min, p.burst_size, p.pulsed_jobs,
  p.before_failure_rate,
  after.pending AS after_pending_30m,
  after.oldest_min AS after_oldest_min_30m,
  after.failure_rate AS after_failure_rate_30m,
  (p.before_pending - after.pending) AS delta_pending,
  (p.before_oldest_min - after.oldest_min) AS delta_oldest_min,
  (p.before_failure_rate - after.failure_rate) AS delta_failure_rate,
  CASE
    WHEN p.before_pending IS NULL OR p.before_pending = 0 THEN NULL
    ELSE ROUND(((p.before_pending - after.pending) / p.before_pending) * 100, 2)
  END AS pending_reduction_pct,
  -- success: pending fell by >=10% in the 30min after pulse
  CASE
    WHEN p.decision = 'pulsed'
     AND p.before_pending IS NOT NULL AND p.before_pending > 0
     AND after.pending IS NOT NULL
     AND ((p.before_pending - after.pending) / p.before_pending) >= 0.10
    THEN true
    ELSE false
  END AS pulse_succeeded
FROM pulses p
LEFT JOIN LATERAL (
  SELECT
    NULLIF(a.metadata->>'pending','')::numeric AS pending,
    NULLIF(a.metadata->>'oldest_min','')::numeric AS oldest_min,
    NULLIF(a.metadata->>'failure_rate_15m','')::numeric AS failure_rate
  FROM public.auto_heal_log a
  WHERE a.action_type = 'auto_recovery_pulse_decide'
    AND a.created_at BETWEEN p.created_at + interval '25 minutes'
                         AND p.created_at + interval '35 minutes'
  ORDER BY abs(EXTRACT(EPOCH FROM (a.created_at - (p.created_at + interval '30 minutes'))))
  LIMIT 1
) after ON true;

REVOKE ALL ON public.v_auto_pulse_impact_30m FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_auto_pulse_impact_30m TO service_role;

-- Admin RPC aggregating the view per decision path
CREATE OR REPLACE FUNCTION public.admin_get_auto_pulse_impact(p_window_days integer DEFAULT 7)
RETURNS TABLE(
  decision text,
  decisions_count integer,
  measured_pairs integer,
  avg_pending_delta numeric,
  avg_failure_rate_delta numeric,
  avg_oldest_min_delta numeric,
  avg_pending_reduction_pct numeric,
  success_count integer,
  success_rate_pct numeric,
  total_pulsed_jobs integer,
  last_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'admin required'; END IF;
  RETURN QUERY
    SELECT v.decision,
           COUNT(*)::integer AS decisions_count,
           COUNT(v.after_pending_30m)::integer AS measured_pairs,
           ROUND(AVG(v.delta_pending)::numeric, 2),
           ROUND(AVG(v.delta_failure_rate)::numeric, 4),
           ROUND(AVG(v.delta_oldest_min)::numeric, 2),
           ROUND(AVG(v.pending_reduction_pct)::numeric, 2),
           COUNT(*) FILTER (WHERE v.pulse_succeeded)::integer AS success_count,
           CASE WHEN COUNT(*) FILTER (WHERE v.decision = 'pulsed' AND v.after_pending_30m IS NOT NULL) = 0 THEN NULL
                ELSE ROUND(
                  (COUNT(*) FILTER (WHERE v.pulse_succeeded)::numeric
                   / NULLIF(COUNT(*) FILTER (WHERE v.decision = 'pulsed' AND v.after_pending_30m IS NOT NULL),0)) * 100, 2)
           END AS success_rate_pct,
           COALESCE(SUM(v.pulsed_jobs)::integer, 0) AS total_pulsed_jobs,
           MAX(v.created_at) AS last_at
      FROM public.v_auto_pulse_impact_30m v
     WHERE v.created_at >= now() - make_interval(days => GREATEST(p_window_days, 1))
     GROUP BY v.decision
     ORDER BY decisions_count DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_get_auto_pulse_impact(integer) TO authenticated;

INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
VALUES ('s3_auto_pulse_impact_measurement','system','auto_recovery_pulse','success',
        jsonb_build_object('migration','s3_m3','components',
          jsonb_build_array('v_auto_pulse_impact_30m','admin_get_auto_pulse_impact')));