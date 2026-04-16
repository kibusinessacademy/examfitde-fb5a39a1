
CREATE OR REPLACE FUNCTION public.fn_detect_repeat_step_failures(
  p_min_failures int DEFAULT 3,
  p_window_hours int DEFAULT 6
)
RETURNS TABLE (
  package_id uuid,
  step_key text,
  failure_count bigint,
  last_error text,
  first_failure_at timestamptz,
  last_failure_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    jq.package_id,
    replace(replace(jq.job_type, 'package_', ''), '-', '_') AS step_key,
    count(*) AS failure_count,
    max(jq.last_error) AS last_error,
    min(jq.completed_at) AS first_failure_at,
    max(jq.completed_at) AS last_failure_at
  FROM job_queue jq
  WHERE jq.status IN ('failed', 'cancelled')
    AND jq.completed_at > now() - make_interval(hours => p_window_hours)
    AND jq.package_id IS NOT NULL
    AND jq.job_type LIKE 'package_%'
  GROUP BY jq.package_id, jq.job_type
  HAVING count(*) >= p_min_failures
  ORDER BY count(*) DESC
  LIMIT 50;
$$;
