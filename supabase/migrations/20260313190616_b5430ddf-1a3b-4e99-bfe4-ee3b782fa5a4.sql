
-- RPC to get AI cost summary with proper server-side aggregation
-- Avoids the 1000-row client-side limit that causes incorrect sums
CREATE OR REPLACE FUNCTION public.get_ai_cost_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'cost_today', COALESCE((
      SELECT sum(cost_eur) FROM llm_cost_events 
      WHERE ts >= (now() AT TIME ZONE 'UTC')::date
    ), 0),
    'cost_mtd', COALESCE((
      SELECT sum(cost_eur) FROM llm_cost_events 
      WHERE ts >= date_trunc('month', now())
    ), 0),
    'events_today', COALESCE((
      SELECT count(*) FROM llm_cost_events 
      WHERE ts >= (now() AT TIME ZONE 'UTC')::date
    ), 0),
    'events_mtd', COALESCE((
      SELECT count(*) FROM llm_cost_events 
      WHERE ts >= date_trunc('month', now())
    ), 0)
  );
$$;
