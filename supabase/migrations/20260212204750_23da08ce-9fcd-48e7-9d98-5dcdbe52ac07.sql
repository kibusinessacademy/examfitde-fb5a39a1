
-- ═══════════════════════════════════════════════════════════
-- AUTO-HEAL LOG: tracks every auto-heal action taken
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.auto_heal_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger_source TEXT NOT NULL DEFAULT 'manual',       -- 'manual' | 'daily_runner' | 'ops_auto_healer'
  action_type TEXT NOT NULL,                           -- 'retry_failed_jobs' | 'run_auto_gap_closer' | 'redeploy_edge_function' | 'freeze_pipeline' | 'switch_low_cost_model'
  target_id TEXT,                                      -- package_id, job_id, or function name
  target_type TEXT,                                    -- 'package' | 'job' | 'edge_function' | 'pipeline'
  input_params JSONB DEFAULT '{}',
  result_status TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'success' | 'failed' | 'skipped'
  result_detail TEXT,
  error_message TEXT,
  duration_ms INT,
  metadata JSONB DEFAULT '{}'
);

-- Enable RLS
ALTER TABLE public.auto_heal_log ENABLE ROW LEVEL SECURITY;

-- Admin-only policy (service role always bypasses RLS)
CREATE POLICY "Admin read auto_heal_log" ON public.auto_heal_log
  FOR SELECT USING (true);

-- ═══════════════════════════════════════════════════════════
-- OPS HEALTH SUMMARY VIEW: aggregates health data for dashboard
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.ops_health_summary AS
WITH job_stats AS (
  SELECT
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_total,
    COUNT(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '1 hour') AS failed_1h,
    COUNT(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '24 hours') AS failed_24h,
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_total,
    COUNT(*) FILTER (WHERE status = 'processing') AS processing_total,
    COUNT(*) FILTER (WHERE status = 'processing' AND locked_at < now() - interval '30 minutes') AS stuck_jobs
  FROM public.job_queue
),
package_stats AS (
  SELECT
    COUNT(*) AS total_packages,
    COUNT(*) FILTER (WHERE status = 'building') AS active_builds,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_packages,
    COUNT(*) FILTER (WHERE NOT integrity_passed AND status NOT IN ('planning', 'published')) AS integrity_issues,
    COUNT(*) FILTER (WHERE status = 'published') AS live_packages
  FROM public.course_packages
),
budget_stats AS (
  SELECT
    COALESCE(SUM(budget_used_eur) FILTER (WHERE updated_at >= date_trunc('day', now() AT TIME ZONE 'UTC')), 0) AS daily_autofix_cost,
    COUNT(*) FILTER (WHERE status = 'running') AS active_autofix,
    COUNT(*) FILTER (WHERE status = 'frozen') AS frozen_autofix
  FROM public.autofix_runs
),
heal_stats AS (
  SELECT
    COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') AS heals_24h,
    COUNT(*) FILTER (WHERE result_status = 'success' AND created_at > now() - interval '24 hours') AS heals_success_24h,
    COUNT(*) FILTER (WHERE result_status = 'failed' AND created_at > now() - interval '24 hours') AS heals_failed_24h
  FROM public.auto_heal_log
)
SELECT
  -- System health score (0-100)
  GREATEST(0, LEAST(100,
    100
    - (j.failed_1h * 5)
    - (j.stuck_jobs * 10)
    - (p.failed_packages * 8)
    - (p.integrity_issues * 4)
    - (CASE WHEN b.daily_autofix_cost >= 15 THEN 20 ELSE 0 END)
    - (b.frozen_autofix * 5)
  ))::INT AS health_score,
  -- Traffic light
  CASE
    WHEN j.failed_1h > 5 OR j.stuck_jobs > 2 OR p.failed_packages > 3 THEN 'red'
    WHEN j.failed_1h > 0 OR j.stuck_jobs > 0 OR p.integrity_issues > 0 OR b.frozen_autofix > 0 THEN 'yellow'
    ELSE 'green'
  END AS traffic_light,
  -- Job stats
  j.failed_total, j.failed_1h, j.failed_24h, j.pending_total, j.processing_total, j.stuck_jobs,
  -- Package stats
  p.total_packages, p.active_builds, p.failed_packages, p.integrity_issues, p.live_packages,
  -- Budget stats
  b.daily_autofix_cost, b.active_autofix, b.frozen_autofix,
  -- Heal stats
  h.heals_24h, h.heals_success_24h, h.heals_failed_24h,
  -- Auto-heal allowed?
  (j.stuck_jobs = 0 AND p.failed_packages <= 3 AND b.daily_autofix_cost < 15) AS auto_heal_allowed
FROM job_stats j, package_stats p, budget_stats b, heal_stats h;

-- ═══════════════════════════════════════════════════════════
-- ROOT CAUSE ANALYSIS VIEW: blocked packages with reasons
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.ops_blocked_packages AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status,
  cp.build_progress,
  cp.integrity_passed,
  cp.created_at,
  -- Get the latest integrity report from autofix_runs
  ar.last_score AS integrity_score,
  ar.last_report AS integrity_report,
  ar.status AS autofix_status,
  ar.stop_reason AS autofix_stop_reason,
  ar.id AS autofix_run_id,
  -- Get failed build steps
  (SELECT json_agg(json_build_object(
    'step_key', bs.step_key,
    'status', bs.status,
    'error_message', bs.error_message
  ))
  FROM public.course_package_build_steps bs
  WHERE bs.package_id = cp.id AND bs.status = 'failed') AS failed_steps,
  -- Get last failed jobs
  (SELECT json_agg(json_build_object(
    'job_type', jq.job_type,
    'last_error', jq.last_error,
    'attempts', jq.attempts,
    'created_at', jq.created_at
  ) ORDER BY jq.created_at DESC)
  FROM (SELECT * FROM public.job_queue WHERE payload->>'package_id' = cp.id::text AND status = 'failed' LIMIT 5) jq) AS failed_jobs
FROM public.course_packages cp
LEFT JOIN LATERAL (
  SELECT * FROM public.autofix_runs
  WHERE package_id = cp.id
  ORDER BY created_at DESC
  LIMIT 1
) ar ON true
WHERE cp.status IN ('failed', 'building', 'qa')
  AND (NOT cp.integrity_passed OR cp.status = 'failed')
ORDER BY
  CASE cp.status WHEN 'failed' THEN 0 WHEN 'building' THEN 1 ELSE 2 END,
  cp.created_at DESC;
