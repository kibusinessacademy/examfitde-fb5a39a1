
CREATE OR REPLACE VIEW public.v_batch_canary_kpi AS
WITH error_counts AS (
  SELECT
    br.batch_id,
    br.model,
    COALESCE(br.error_body->>'code', 'unknown') AS error_code,
    COUNT(*) AS cnt
  FROM llm_batch_requests br
  WHERE br.error_body IS NOT NULL
  GROUP BY br.batch_id, br.model, COALESCE(br.error_body->>'code', 'unknown')
),
error_agg AS (
  SELECT
    ec.batch_id,
    ec.model,
    jsonb_object_agg(ec.error_code, ec.cnt) AS error_codes
  FROM error_counts ec
  GROUP BY ec.batch_id, ec.model
)
SELECT
  br.model,
  lb.status AS batch_status,
  COUNT(*) AS request_count,
  COUNT(*) FILTER (WHERE br.status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE br.status = 'failed') AS failed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE br.status = 'completed') / NULLIF(COUNT(*), 0), 1
  ) AS success_rate_pct,
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (br.completed_at - br.created_at))
  ) FILTER (WHERE br.completed_at IS NOT NULL) AS median_duration_s,
  ea.error_codes,
  MIN(br.created_at) AS first_seen,
  MAX(br.created_at) AS last_seen
FROM llm_batch_requests br
JOIN llm_batches lb ON lb.id = br.batch_id
LEFT JOIN error_agg ea ON ea.batch_id = lb.id AND ea.model = br.model
WHERE lb.metadata->>'batch_mode' = 'canary'
GROUP BY br.model, lb.status, ea.error_codes;

COMMENT ON VIEW public.v_batch_canary_kpi IS 'Canary batch KPI: success rate, error codes, duration per model';
