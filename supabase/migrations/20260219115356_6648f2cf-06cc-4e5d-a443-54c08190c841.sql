
-- Fix Budget: Update ops_health_summary to include REAL LLM costs from llm_cost_events
CREATE OR REPLACE VIEW public.ops_health_summary AS
WITH job_stats AS (
  SELECT 
    count(*) FILTER (WHERE status = 'failed') AS failed_total,
    count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '1 hour') AS failed_1h,
    count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '24 hours') AS failed_24h,
    count(*) FILTER (WHERE status = 'pending') AS pending_total,
    count(*) FILTER (WHERE status = 'processing') AS processing_total,
    count(*) FILTER (WHERE status = 'processing' AND locked_at < now() - interval '30 minutes') AS stuck_jobs
  FROM job_queue
),
package_stats AS (
  SELECT
    count(*) AS total_packages,
    count(*) FILTER (WHERE status = 'building') AS active_builds,
    count(*) FILTER (WHERE status = 'failed') AS failed_packages,
    count(*) FILTER (WHERE NOT integrity_passed AND status NOT IN ('planning','published')) AS integrity_issues,
    count(*) FILTER (WHERE status = 'published') AS live_packages
  FROM course_packages
),
budget_stats AS (
  SELECT
    COALESCE(sum(budget_used_eur) FILTER (WHERE updated_at >= date_trunc('day', now() AT TIME ZONE 'UTC')), 0) AS daily_autofix_cost,
    count(*) FILTER (WHERE status = 'running') AS active_autofix,
    count(*) FILTER (WHERE status = 'frozen') AS frozen_autofix
  FROM autofix_runs
),
llm_cost_stats AS (
  SELECT
    COALESCE(sum(cost_eur) FILTER (WHERE ts >= date_trunc('day', now() AT TIME ZONE 'UTC')), 0) AS daily_llm_cost
  FROM llm_cost_events
),
heal_stats AS (
  SELECT
    count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS heals_24h,
    count(*) FILTER (WHERE result_status = 'success' AND created_at > now() - interval '24 hours') AS heals_success_24h,
    count(*) FILTER (WHERE result_status = 'failed' AND created_at > now() - interval '24 hours') AS heals_failed_24h
  FROM auto_heal_log
)
SELECT
  GREATEST(0, LEAST(100, 100 
    - j.failed_1h * 5 
    - j.stuck_jobs * 10 
    - p.failed_packages * 8 
    - p.integrity_issues * 4
    - CASE WHEN b.daily_autofix_cost >= 15 THEN 20 ELSE 0 END
    - b.frozen_autofix * 5
  ))::integer AS health_score,
  CASE
    WHEN j.failed_1h > 5 OR j.stuck_jobs > 2 OR p.failed_packages > 3 THEN 'red'
    WHEN j.failed_1h > 0 OR j.stuck_jobs > 0 OR p.integrity_issues > 0 OR b.frozen_autofix > 0 THEN 'yellow'
    ELSE 'green'
  END AS traffic_light,
  j.failed_total,
  j.failed_1h,
  j.failed_24h,
  j.pending_total,
  j.processing_total,
  j.stuck_jobs,
  p.total_packages,
  p.active_builds,
  p.failed_packages,
  p.integrity_issues,
  p.live_packages,
  -- FIXED: Show actual LLM costs, not just autofix costs
  GREATEST(b.daily_autofix_cost, l.daily_llm_cost) AS daily_autofix_cost,
  b.active_autofix,
  b.frozen_autofix,
  h.heals_24h,
  h.heals_success_24h,
  h.heals_failed_24h,
  (j.stuck_jobs = 0 AND p.failed_packages <= 3 AND b.daily_autofix_cost < 15) AS auto_heal_allowed
FROM job_stats j, package_stats p, budget_stats b, llm_cost_stats l, heal_stats h;
