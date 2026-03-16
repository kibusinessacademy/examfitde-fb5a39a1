
CREATE OR REPLACE VIEW public.v_ops_executive_kpis AS
WITH
  wip_limit AS (SELECT 5 AS max_slots),
  active_building AS (
    SELECT count(*) AS cnt FROM course_packages WHERE status = 'building'
  ),
  active_jobs AS (
    SELECT count(*) AS cnt FROM job_queue WHERE status = 'processing'
  ),
  building_without_job AS (
    SELECT count(*) AS cnt
    FROM course_packages cp
    WHERE cp.status = 'building'
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = cp.id AND jq.status IN ('processing', 'pending')
      )
  ),
  completed_packages AS (
    SELECT cp.id AS package_id, count(jq.id) AS job_count
    FROM course_packages cp
    LEFT JOIN job_queue jq ON jq.package_id = cp.id
    WHERE cp.status IN ('done', 'published')
    GROUP BY cp.id
  ),
  jobs_per_pkg AS (
    SELECT
      coalesce(avg(job_count), 0) AS avg_jobs,
      coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY job_count), 0) AS median_jobs,
      count(*) AS sample_size
    FROM completed_packages
  ),
  recent_window AS (SELECT now() - interval '24 hours' AS since),
  job_outcomes AS (
    SELECT
      count(*) FILTER (WHERE status = 'completed' AND attempts <= 1) AS first_pass,
      count(*) FILTER (WHERE status = 'completed') AS total_completed,
      count(*) FILTER (WHERE status = 'failed') AS total_failed,
      count(*) FILTER (WHERE status = 'cancelled') AS total_cancelled
    FROM job_queue, recent_window
    WHERE updated_at >= recent_window.since
      AND status IN ('completed', 'failed', 'cancelled')
  ),
  cost_snapshot AS (
    SELECT
      coalesce(sum(cost_eur) FILTER (WHERE ts >= now() - interval '24 hours'), 0) AS cost_24h,
      coalesce(sum(cost_eur) FILTER (WHERE ts >= now() - interval '7 days'), 0) AS cost_7d,
      coalesce(sum(cost_eur), 0) AS cost_total
    FROM llm_cost_events
  ),
  pipeline_counts AS (
    SELECT
      count(*) FILTER (WHERE status = 'building') AS building,
      count(*) FILTER (WHERE status = 'queued') AS queued,
      count(*) FILTER (WHERE status = 'blocked') AS blocked,
      count(*) FILTER (WHERE status IN ('done', 'published')) AS completed,
      count(*) FILTER (WHERE status = 'failed') AS failed,
      count(*) AS total
    FROM course_packages
  ),
  throughput AS (
    SELECT count(*) AS jobs_completed_2h
    FROM job_queue
    WHERE status = 'completed' AND updated_at >= now() - interval '2 hours'
  )
SELECT
  (SELECT cnt FROM active_jobs) AS active_jobs,
  (SELECT max_slots FROM wip_limit) AS max_slots,
  (SELECT cnt FROM active_building) AS building_packages,
  (SELECT cnt FROM building_without_job) AS building_without_job,
  CASE WHEN (SELECT max_slots FROM wip_limit) = 0 THEN 0
    ELSE round(((SELECT cnt FROM active_jobs)::numeric / (SELECT max_slots FROM wip_limit)) * 100, 1)
  END AS runner_utilization_pct,
  CASE
    WHEN round(((SELECT cnt FROM active_jobs)::numeric / GREATEST((SELECT max_slots FROM wip_limit), 1)) * 100, 1) >= 85 THEN 'green'
    WHEN round(((SELECT cnt FROM active_jobs)::numeric / GREATEST((SELECT max_slots FROM wip_limit), 1)) * 100, 1) >= 60 THEN 'yellow'
    ELSE 'red'
  END AS runner_utilization_signal,
  (SELECT avg_jobs FROM jobs_per_pkg) AS avg_jobs_per_package,
  (SELECT median_jobs FROM jobs_per_pkg) AS median_jobs_per_package,
  (SELECT sample_size FROM jobs_per_pkg) AS completed_package_sample,
  CASE
    WHEN (SELECT avg_jobs FROM jobs_per_pkg) <= 20 THEN 'green'
    WHEN (SELECT avg_jobs FROM jobs_per_pkg) <= 35 THEN 'yellow'
    ELSE 'red'
  END AS jobs_per_package_signal,
  (SELECT first_pass FROM job_outcomes) AS first_pass_jobs_24h,
  (SELECT total_completed FROM job_outcomes) AS total_completed_24h,
  (SELECT total_failed FROM job_outcomes) AS total_failed_24h,
  CASE WHEN (SELECT total_completed FROM job_outcomes) = 0 THEN 0
    ELSE round(((SELECT first_pass FROM job_outcomes)::numeric / (SELECT total_completed FROM job_outcomes)) * 100, 1)
  END AS first_pass_yield_pct,
  CASE
    WHEN (SELECT total_completed FROM job_outcomes) = 0 THEN 'neutral'
    WHEN round(((SELECT first_pass FROM job_outcomes)::numeric / GREATEST((SELECT total_completed FROM job_outcomes), 1)) * 100, 1) >= 80 THEN 'green'
    WHEN round(((SELECT first_pass FROM job_outcomes)::numeric / GREATEST((SELECT total_completed FROM job_outcomes), 1)) * 100, 1) >= 70 THEN 'yellow'
    ELSE 'red'
  END AS first_pass_yield_signal,
  (SELECT cost_24h FROM cost_snapshot) AS cost_24h_eur,
  (SELECT cost_7d FROM cost_snapshot) AS cost_7d_eur,
  (SELECT cost_total FROM cost_snapshot) AS cost_total_eur,
  (SELECT building FROM pipeline_counts) AS pkg_building,
  (SELECT queued FROM pipeline_counts) AS pkg_queued,
  (SELECT blocked FROM pipeline_counts) AS pkg_blocked,
  (SELECT completed FROM pipeline_counts) AS pkg_completed,
  (SELECT failed FROM pipeline_counts) AS pkg_failed,
  (SELECT total FROM pipeline_counts) AS pkg_total,
  (SELECT jobs_completed_2h FROM throughput) AS throughput_2h,
  round((SELECT jobs_completed_2h FROM throughput)::numeric / 2, 1) AS throughput_per_hour,
  CASE WHEN (SELECT jobs_completed_2h FROM throughput) = 0 THEN NULL
    ELSE round(
      ((SELECT total FROM pipeline_counts) - (SELECT completed FROM pipeline_counts))::numeric
      * GREATEST((SELECT avg_jobs FROM jobs_per_pkg), 25)
      / GREATEST((SELECT jobs_completed_2h FROM throughput)::numeric / 2, 1)
      / 24, 1)
  END AS eta_days,
  CASE
    WHEN (SELECT cnt FROM building_without_job) > 2 OR (SELECT blocked FROM pipeline_counts) > 3 THEN 'red'
    WHEN round(((SELECT cnt FROM active_jobs)::numeric / GREATEST((SELECT max_slots FROM wip_limit), 1)) * 100, 1) < 60
      OR (SELECT blocked FROM pipeline_counts) > 0 THEN 'yellow'
    ELSE 'green'
  END AS overall_signal;
