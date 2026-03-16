
DROP VIEW IF EXISTS public.v_ops_executive_kpis;

CREATE VIEW public.v_ops_executive_kpis AS
WITH
  wip_limit AS (SELECT 5 AS max_slots),
  active_jobs AS (
    SELECT count(*)::int AS cnt FROM public.job_queue
    WHERE status IN ('pending', 'processing') AND coalesce(run_after, now()) <= now()
  ),
  building_without_job AS (
    SELECT count(*)::int AS cnt FROM public.course_packages cp
    WHERE cp.status = 'building' AND NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = cp.id AND jq.status IN ('pending', 'processing') AND coalesce(jq.run_after, now()) <= now()
    )
  ),
  package_job_counts AS (
    SELECT jq.package_id, count(*) FILTER (WHERE jq.status = 'completed')::numeric AS completed_jobs
    FROM public.job_queue jq WHERE jq.package_id IS NOT NULL GROUP BY jq.package_id
  ),
  successful_packages AS (
    SELECT cp.id, pjc.completed_jobs FROM public.course_packages cp
    JOIN package_job_counts pjc ON pjc.package_id = cp.id WHERE cp.status IN ('done', 'published')
  ),
  jobs_per_pkg AS (
    SELECT count(*)::int AS sample_size,
      avg(completed_jobs)::numeric(12,2) AS avg_jobs,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY completed_jobs)::numeric(12,2) AS median_jobs
    FROM successful_packages
  ),
  terminal_jobs_24h AS (
    SELECT jq.status, jq.attempts FROM public.job_queue jq
    WHERE jq.updated_at >= now() - interval '24 hours' AND jq.status IN ('completed', 'failed', 'cancelled')
  ),
  job_outcomes AS (
    SELECT
      count(*) FILTER (WHERE status = 'completed')::int AS total_completed,
      count(*) FILTER (WHERE status = 'failed')::int AS total_failed,
      count(*) FILTER (WHERE status = 'cancelled')::int AS total_cancelled,
      count(*) FILTER (WHERE status = 'completed' AND coalesce(attempts, 0) <= 1)::int AS first_pass_completed,
      count(*)::int AS total_terminal
    FROM terminal_jobs_24h
  ),
  cost_snapshot AS (
    SELECT
      coalesce(sum(cost_eur) FILTER (WHERE ts >= now() - interval '24 hours'), 0)::numeric(12,2) AS cost_24h,
      coalesce(sum(cost_eur) FILTER (WHERE ts >= now() - interval '7 days'), 0)::numeric(12,2) AS cost_7d,
      coalesce(sum(cost_eur), 0)::numeric(12,2) AS cost_total
    FROM public.llm_cost_events
  ),
  pipeline_counts AS (
    SELECT
      count(*) FILTER (WHERE status = 'building')::int AS building,
      count(*) FILTER (WHERE status = 'queued')::int AS queued,
      count(*) FILTER (WHERE status = 'blocked')::int AS blocked,
      count(*) FILTER (WHERE status = 'done')::int AS done,
      count(*) FILTER (WHERE status = 'published')::int AS published,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*)::int AS total
    FROM public.course_packages
  ),
  throughput AS (
    SELECT count(*)::int AS jobs_2h FROM public.job_queue
    WHERE status = 'completed' AND updated_at >= now() - interval '2 hours'
  ),
  eta_inputs AS (
    SELECT
      (SELECT jobs_2h FROM throughput)::numeric / 2.0 AS jobs_per_hour,
      (SELECT avg_jobs FROM jobs_per_pkg) AS obs_avg,
      greatest((SELECT total FROM pipeline_counts) - (SELECT published FROM pipeline_counts), 0)::numeric AS remaining
  )
SELECT
  -- Runner
  (SELECT cnt FROM active_jobs)::int AS active_jobs,
  (SELECT max_slots FROM wip_limit)::int AS max_slots,
  (SELECT count(*)::int FROM public.course_packages WHERE status = 'building') AS building_packages,
  (SELECT cnt FROM building_without_job)::int AS building_without_job,
  CASE WHEN (SELECT max_slots FROM wip_limit) = 0 THEN 0::numeric
    ELSE round(((SELECT cnt FROM active_jobs)::numeric / (SELECT max_slots FROM wip_limit)::numeric) * 100, 1)
  END AS runner_utilization_pct,
  CASE
    WHEN round(((SELECT cnt FROM active_jobs)::numeric / greatest((SELECT max_slots FROM wip_limit), 1)::numeric) * 100, 1) >= 85 THEN 'green'
    WHEN round(((SELECT cnt FROM active_jobs)::numeric / greatest((SELECT max_slots FROM wip_limit), 1)::numeric) * 100, 1) >= 60 THEN 'yellow'
    ELSE 'red'
  END AS runner_utilization_signal,

  -- Jobs per package
  coalesce((SELECT avg_jobs FROM jobs_per_pkg), 0)::numeric(12,2) AS avg_jobs_per_package,
  coalesce((SELECT median_jobs FROM jobs_per_pkg), 0)::numeric(12,2) AS median_jobs_per_package,
  coalesce((SELECT sample_size FROM jobs_per_pkg), 0)::int AS completed_package_sample,
  CASE
    WHEN coalesce((SELECT sample_size FROM jobs_per_pkg), 0) = 0 THEN 'neutral'
    WHEN (SELECT avg_jobs FROM jobs_per_pkg) <= 20 THEN 'green'
    WHEN (SELECT avg_jobs FROM jobs_per_pkg) <= 35 THEN 'yellow'
    ELSE 'red'
  END AS jobs_per_package_signal,

  -- FPY
  (SELECT first_pass_completed FROM job_outcomes)::int AS first_pass_completed_24h,
  (SELECT total_completed FROM job_outcomes)::int AS total_completed_24h,
  (SELECT total_failed FROM job_outcomes)::int AS total_failed_24h,
  (SELECT total_cancelled FROM job_outcomes)::int AS total_cancelled_24h,
  (SELECT total_terminal FROM job_outcomes)::int AS total_terminal_24h,
  CASE WHEN (SELECT total_terminal FROM job_outcomes) = 0 THEN 0::numeric
    ELSE round(((SELECT first_pass_completed FROM job_outcomes)::numeric / (SELECT total_terminal FROM job_outcomes)::numeric) * 100, 1)
  END AS first_pass_yield_pct,
  CASE
    WHEN (SELECT total_terminal FROM job_outcomes) = 0 THEN 'neutral'
    WHEN round(((SELECT first_pass_completed FROM job_outcomes)::numeric / greatest((SELECT total_terminal FROM job_outcomes), 1)::numeric) * 100, 1) >= 80 THEN 'green'
    WHEN round(((SELECT first_pass_completed FROM job_outcomes)::numeric / greatest((SELECT total_terminal FROM job_outcomes), 1)::numeric) * 100, 1) >= 70 THEN 'yellow'
    ELSE 'red'
  END AS first_pass_yield_signal,

  -- Cost
  (SELECT cost_24h FROM cost_snapshot) AS cost_24h_eur,
  (SELECT cost_7d FROM cost_snapshot) AS cost_7d_eur,
  (SELECT cost_total FROM cost_snapshot) AS cost_total_eur,

  -- Pipeline (done + published split)
  (SELECT building FROM pipeline_counts)::int AS pkg_building,
  (SELECT queued FROM pipeline_counts)::int AS pkg_queued,
  (SELECT blocked FROM pipeline_counts)::int AS pkg_blocked,
  (SELECT done FROM pipeline_counts)::int AS pkg_done,
  (SELECT published FROM pipeline_counts)::int AS pkg_published,
  (SELECT failed FROM pipeline_counts)::int AS pkg_failed,
  (SELECT total FROM pipeline_counts)::int AS pkg_total,

  -- Throughput
  (SELECT jobs_2h FROM throughput)::int AS throughput_2h,
  round((SELECT jobs_2h FROM throughput)::numeric / 2.0, 1) AS throughput_per_hour,

  -- Dual ETA
  CASE
    WHEN (SELECT jobs_per_hour FROM eta_inputs) <= 0 THEN NULL
    WHEN coalesce((SELECT obs_avg FROM eta_inputs), 0) <= 0 THEN NULL
    ELSE round((SELECT remaining FROM eta_inputs) * (SELECT obs_avg FROM eta_inputs) / greatest((SELECT jobs_per_hour FROM eta_inputs), 1) / 24.0, 1)
  END AS observed_eta_days,
  CASE
    WHEN (SELECT jobs_per_hour FROM eta_inputs) <= 0 THEN NULL
    ELSE round((SELECT remaining FROM eta_inputs) * 25.0 / greatest((SELECT jobs_per_hour FROM eta_inputs), 1) / 24.0, 1)
  END AS planning_eta_days,

  -- Overall signal (hardened)
  CASE
    WHEN (SELECT blocked FROM pipeline_counts) > 3 THEN 'red'
    WHEN (SELECT cnt FROM building_without_job) > 2 THEN 'red'
    WHEN (SELECT total_terminal FROM job_outcomes) > 0
      AND round(((SELECT first_pass_completed FROM job_outcomes)::numeric / greatest((SELECT total_terminal FROM job_outcomes), 1)::numeric) * 100, 1) < 70 THEN 'red'
    WHEN (SELECT published FROM pipeline_counts) = 0
      AND ((SELECT building FROM pipeline_counts) > 0 OR (SELECT queued FROM pipeline_counts) > 0) THEN 'yellow'
    WHEN round(((SELECT cnt FROM active_jobs)::numeric / greatest((SELECT max_slots FROM wip_limit), 1)::numeric) * 100, 1) < 60 THEN 'yellow'
    WHEN (SELECT blocked FROM pipeline_counts) > 0 THEN 'yellow'
    WHEN (SELECT cnt FROM building_without_job) > 0 THEN 'yellow'
    WHEN (SELECT total_terminal FROM job_outcomes) > 0
      AND round(((SELECT first_pass_completed FROM job_outcomes)::numeric / greatest((SELECT total_terminal FROM job_outcomes), 1)::numeric) * 100, 1) < 80 THEN 'yellow'
    ELSE 'green'
  END AS overall_signal,

  -- Definitions
  'active_jobs / max_slots'::text AS runner_utilization_definition,
  'completed jobs across done/published packages'::text AS jobs_per_package_definition,
  'jobs with attempts<=1 / all terminal jobs (24h)'::text AS first_pass_yield_definition,
  'observed uses real avg; planning uses 25 jobs/pkg floor'::text AS eta_definition;
