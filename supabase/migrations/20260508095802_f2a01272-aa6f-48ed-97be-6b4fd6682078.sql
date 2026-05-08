-- Fix v_admin_lane_health: include lanes with completions but no active jobs.
-- Root: active LEFT JOIN completed → completed-only lanes (z.B. recovery 68 in 6h) verschwinden.
-- Fix: FULL OUTER JOIN über active+completed+dispatch, lane via COALESCE.

DROP VIEW IF EXISTS public.v_admin_lane_health CASCADE;

CREATE VIEW public.v_admin_lane_health AS
WITH active AS (
  SELECT COALESCE(lane,'unknown') AS lane,
    (count(*) FILTER (WHERE status='pending'))::int AS pending_cnt,
    (count(*) FILTER (WHERE status='processing'))::int AS processing_cnt,
    (count(*) FILTER (WHERE status='queued'))::int AS queued_cnt,
    (max(EXTRACT(epoch FROM (now()-created_at))) FILTER (WHERE status IN ('pending','queued')))::int AS oldest_pending_sec
  FROM job_queue
  WHERE status IN ('pending','processing','queued')
  GROUP BY 1
), completed_stats AS (
  SELECT COALESCE(lane,'unknown') AS lane,
    max(completed_at) AS last_completed_at,
    (count(*) FILTER (WHERE completed_at >= now()-interval '6 hours'))::int AS completed_6h
  FROM job_queue
  WHERE status='completed' AND completed_at >= now()-interval '7 days'
  GROUP BY 1
), dispatch_signal AS (
  SELECT COALESCE(lane,'unknown') AS lane,
    (count(*) FILTER (WHERE locked_at>=now()-interval '5 minutes' OR started_at>=now()-interval '5 minutes' OR completed_at>=now()-interval '5 minutes'))::int AS dispatched_recent_5m,
    max(GREATEST(COALESCE(locked_at,'epoch'::timestamptz), COALESCE(started_at,'epoch'::timestamptz), COALESCE(completed_at,'epoch'::timestamptz))) AS last_worker_activity_at
  FROM job_queue
  WHERE locked_at>=now()-interval '1 hour' OR started_at>=now()-interval '1 hour' OR completed_at>=now()-interval '1 hour'
  GROUP BY 1
), all_lanes AS (
  SELECT lane FROM active UNION SELECT lane FROM completed_stats UNION SELECT lane FROM dispatch_signal
)
SELECT
  al.lane,
  COALESCE(a.pending_cnt,0) AS pending_cnt,
  COALESCE(a.processing_cnt,0) AS processing_cnt,
  COALESCE(a.queued_cnt,0) AS queued_cnt,
  c.last_completed_at,
  COALESCE(c.completed_6h,0) AS completed_6h,
  a.oldest_pending_sec,
  COALESCE(d.dispatched_recent_5m,0) AS dispatched_recent_5m,
  d.last_worker_activity_at
FROM all_lanes al
LEFT JOIN active a USING (lane)
LEFT JOIN completed_stats c USING (lane)
LEFT JOIN dispatch_signal d USING (lane);

REVOKE ALL ON public.v_admin_lane_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_lane_health TO service_role;

-- RPC bleibt: admin_get_lane_health (SECURITY DEFINER + has_role-Gate) — neu binden, da CASCADE droppte.
CREATE OR REPLACE FUNCTION public.admin_get_lane_health()
RETURNS SETOF public.v_admin_lane_health
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY SELECT * FROM public.v_admin_lane_health;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_lane_health() TO authenticated;

-- Smoke: must list 'recovery' with completed_6h>0 if recent completions exist.
-- SELECT lane, completed_6h FROM v_admin_lane_health WHERE lane='recovery';