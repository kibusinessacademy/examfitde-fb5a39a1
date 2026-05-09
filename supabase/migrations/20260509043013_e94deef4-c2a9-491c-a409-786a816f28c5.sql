-- S3 Migration 2: Gate-History Drift + Lane-Pivot + Package-Timeline (Track B)

-- Drift over days (count per decision per day)
CREATE OR REPLACE FUNCTION public.admin_get_gate_decision_drift(p_window_days integer DEFAULT 30)
RETURNS TABLE(day date, decision text, decisions_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'admin required'; END IF;
  RETURN QUERY
    SELECT (recorded_at AT TIME ZONE 'UTC')::date AS day,
           h.decision,
           COUNT(*)::integer
      FROM public.quality_gate_decision_history h
     WHERE recorded_at >= now() - make_interval(days => GREATEST(p_window_days, 1))
     GROUP BY 1, 2
     ORDER BY 1 ASC, 2 ASC;
END $$;

-- Lane × Decision pivot for a window with delta to prior period of equal length.
-- Lane is read from inputs->>'lane' (snapshot at decision time), fallback 'unknown'.
CREATE OR REPLACE FUNCTION public.admin_get_gate_decision_lane_pivot(p_window_hours integer DEFAULT 168)
RETURNS TABLE(lane text, decision text,
              current_count integer, prev_count integer, delta_count integer,
              delta_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now timestamptz := now();
  v_window interval := make_interval(hours => GREATEST(p_window_hours, 1));
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'admin required'; END IF;
  RETURN QUERY
    WITH cur AS (
      SELECT COALESCE(NULLIF(inputs->>'lane',''),'unknown') AS lane,
             decision, COUNT(*)::integer AS c
        FROM public.quality_gate_decision_history
       WHERE recorded_at >= v_now - v_window
       GROUP BY 1, 2
    ),
    prev AS (
      SELECT COALESCE(NULLIF(inputs->>'lane',''),'unknown') AS lane,
             decision, COUNT(*)::integer AS c
        FROM public.quality_gate_decision_history
       WHERE recorded_at >= v_now - 2 * v_window
         AND recorded_at <  v_now - v_window
       GROUP BY 1, 2
    ),
    keys AS (
      SELECT lane, decision FROM cur
      UNION
      SELECT lane, decision FROM prev
    )
    SELECT k.lane, k.decision,
           COALESCE(cur.c, 0) AS current_count,
           COALESCE(prev.c, 0) AS prev_count,
           (COALESCE(cur.c, 0) - COALESCE(prev.c, 0))::integer AS delta_count,
           CASE WHEN COALESCE(prev.c, 0) = 0 THEN NULL
                ELSE ROUND(((COALESCE(cur.c, 0) - prev.c)::numeric / prev.c) * 100, 2)
           END AS delta_pct
      FROM keys k
      LEFT JOIN cur  ON cur.lane = k.lane AND cur.decision = k.decision
      LEFT JOIN prev ON prev.lane = k.lane AND prev.decision = k.decision
     ORDER BY current_count DESC, k.lane, k.decision;
END $$;

-- Per-package timeline (alias/wrapper around existing admin_get_gate_decision_history with default args)
CREATE OR REPLACE FUNCTION public.admin_get_gate_decision_package_timeline(
  p_package_id uuid, p_limit integer DEFAULT 30
)
RETURNS TABLE(id uuid, decision text, prev_decision text, quality_score numeric,
              quality_badge text, bronze_locked boolean, report_status text,
              rules_failed integer, rules_warned integer, report_signal text,
              inputs jsonb, recorded_at timestamptz, recorded_by text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'admin required'; END IF;
  RETURN QUERY
    SELECT h.id, h.decision, h.prev_decision, h.quality_score, h.quality_badge,
           h.bronze_locked, h.report_status, h.rules_failed, h.rules_warned, h.report_signal,
           h.inputs, h.recorded_at, h.recorded_by
      FROM public.quality_gate_decision_history h
     WHERE h.package_id = p_package_id
     ORDER BY h.recorded_at DESC
     LIMIT GREATEST(LEAST(p_limit, 200), 1);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_get_gate_decision_drift(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_gate_decision_lane_pivot(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_gate_decision_package_timeline(uuid, integer) TO authenticated;

INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
VALUES ('s3_gate_history_dashboard','system','quality_gate_decision_history','success',
        jsonb_build_object('migration','s3_m2','rpcs',
          jsonb_build_array('admin_get_gate_decision_drift',
            'admin_get_gate_decision_lane_pivot','admin_get_gate_decision_package_timeline')));