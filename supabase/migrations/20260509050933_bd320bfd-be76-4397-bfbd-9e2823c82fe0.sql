
CREATE OR REPLACE FUNCTION public.admin_get_gate_decision_package_timeline_filtered_service(
  p_package_id uuid,
  p_window_days integer DEFAULT 90,
  p_lane text DEFAULT NULL,
  p_decision text DEFAULT NULL,
  p_limit integer DEFAULT 5000,
  p_offset integer DEFAULT 0
) RETURNS TABLE (
  id uuid,
  decision text,
  prev_decision text,
  quality_score numeric,
  quality_badge text,
  bronze_locked boolean,
  recorded_at timestamptz,
  recorded_by text,
  inputs jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := current_setting('request.jwt.claims', true)::jsonb->>'role';
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role only';
  END IF;
  RETURN QUERY
  SELECT g.id, g.decision, g.prev_decision, g.quality_score, g.quality_badge,
         g.bronze_locked, g.recorded_at, g.recorded_by::text, g.inputs
  FROM public.quality_gate_decision_history g
  WHERE g.package_id = p_package_id
    AND g.recorded_at >= now() - (GREATEST(p_window_days,1) || ' days')::interval
    AND (p_decision IS NULL OR g.decision = p_decision)
    AND (p_lane IS NULL OR (g.inputs->>'lane') = p_lane)
  ORDER BY g.recorded_at DESC
  LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0);
END $$;

REVOKE ALL ON FUNCTION public.admin_get_gate_decision_package_timeline_filtered_service(uuid,integer,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_gate_decision_package_timeline_filtered_service(uuid,integer,text,text,integer,integer)
  TO service_role;
