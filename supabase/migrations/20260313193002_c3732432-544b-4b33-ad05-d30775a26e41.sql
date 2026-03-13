
-- Cancel duplicate fan-out exam_pool sub-jobs (keep only newest per LF per package)
WITH ranked AS (
  SELECT id, 
    ROW_NUMBER() OVER (
      PARTITION BY package_id, payload->>'learning_field_filter'
      ORDER BY created_at DESC
    ) as rn
  FROM job_queue 
  WHERE job_type = 'package_generate_exam_pool'
  AND status IN ('pending', 'processing')
  AND payload->>'_fan_out' = 'true'
)
UPDATE job_queue SET status = 'cancelled', updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Also update get_ai_cost_summary to include ai_usage_log as a secondary source
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
    ), 0) + COALESCE((
      SELECT sum(cost_eur) FROM ai_usage_log 
      WHERE created_at >= (now() AT TIME ZONE 'UTC')::date
    ), 0),
    'cost_mtd', COALESCE((
      SELECT sum(cost_eur) FROM llm_cost_events 
      WHERE ts >= date_trunc('month', now())
    ), 0) + COALESCE((
      SELECT sum(cost_eur) FROM ai_usage_log 
      WHERE created_at >= date_trunc('month', now())
    ), 0),
    'events_today', COALESCE((
      SELECT count(*) FROM llm_cost_events 
      WHERE ts >= (now() AT TIME ZONE 'UTC')::date
    ), 0) + COALESCE((
      SELECT count(*) FROM ai_usage_log 
      WHERE created_at >= (now() AT TIME ZONE 'UTC')::date
    ), 0),
    'events_mtd', COALESCE((
      SELECT count(*) FROM llm_cost_events 
      WHERE ts >= date_trunc('month', now())
    ), 0) + COALESCE((
      SELECT count(*) FROM ai_usage_log 
      WHERE created_at >= date_trunc('month', now())
    ), 0)
  );
$$;
