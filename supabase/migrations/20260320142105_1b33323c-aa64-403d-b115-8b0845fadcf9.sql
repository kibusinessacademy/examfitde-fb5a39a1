
-- Drop old naive ETA view and recreate with step-weighted model
DROP VIEW IF EXISTS public.v_building_package_eta;

CREATE VIEW public.v_building_package_eta AS
WITH step_weights AS (
  SELECT * FROM (VALUES
    ('scaffold_learning_course',   0.18),
    ('generate_glossary',          0.06),
    ('fanout_learning_content',    0.10),
    ('generate_learning_content',  1.80),
    ('finalize_learning_content',  2.00),
    ('validate_learning_content',  0.96),
    ('auto_seed_exam_blueprints',  0.18),
    ('validate_blueprints',        0.15),
    ('generate_exam_pool',         8.93),
    ('validate_exam_pool',         0.10),
    ('generate_lesson_minichecks', 7.27),
    ('validate_lesson_minichecks', 0.05),
    ('generate_handbook',          0.10),
    ('validate_handbook',          0.05),
    ('enqueue_handbook_expand',    0.05),
    ('expand_handbook',            6.93),
    ('validate_handbook_depth',    9.28),
    ('generate_oral_exam',         0.50),
    ('validate_oral_exam',         0.10),
    ('build_ai_tutor_index',       0.10),
    ('validate_tutor_index',       0.05),
    ('elite_harden',               2.00),
    ('quality_council',            1.00),
    ('run_integrity_check',        0.20),
    ('auto_publish',               0.05),
    ('generate_curriculum',        0.10),
    ('generate_modules',           0.10),
    ('generate_lessons',           0.10),
    ('generate_lesson_content',    1.80),
    ('generate_exam_questions',    4.00),
    ('validate_exam_questions',    0.50),
    ('generate_handbook_content',  2.00),
    ('validate_handbook_content',  0.50),
    ('generate_oral_exam_content', 2.00),
    ('validate_oral_exam_content', 0.50),
    ('generate_tutor_index',       0.10),
    ('setup_course_package',       0.05),
    ('setup_storefront',           0.10),
    ('launch_marketing',           0.10),
    ('post_launch_monitor',        0.10),
    ('council_review',             1.00)
  ) AS t(step_key, p75_hours)
),
pkg_steps AS (
  SELECT
    ps.package_id,
    ps.step_key,
    ps.status::text AS step_status,
    sw.p75_hours
  FROM package_steps ps
  LEFT JOIN step_weights sw ON sw.step_key = ps.step_key
),
pkg_agg AS (
  SELECT
    package_id,
    count(*) AS total_steps,
    count(*) FILTER (WHERE step_status IN ('done', 'skipped')) AS done_steps,
    count(*) FILTER (WHERE step_status = 'running') AS running_steps,
    count(*) FILTER (WHERE step_status = 'blocked') AS blocked_steps,
    count(*) FILTER (WHERE step_status = 'failed') AS failed_steps,
    COALESCE(sum(COALESCE(p75_hours, 0.50)) FILTER (WHERE step_status NOT IN ('done', 'skipped')), 0) AS remaining_p75_hours,
    COALESCE(sum(COALESCE(p75_hours, 0.50)) FILTER (WHERE step_status IN ('done', 'skipped')), 0) AS done_p75_hours,
    COALESCE(sum(COALESCE(p75_hours, 0.50)), 0) AS total_p75_hours,
    (array_agg(step_key ORDER BY COALESCE(p75_hours, 0.50) DESC) FILTER (WHERE step_status NOT IN ('done', 'skipped')))[1] AS bottleneck_step,
    (max(COALESCE(p75_hours, 0.50)) FILTER (WHERE step_status NOT IN ('done', 'skipped'))) AS bottleneck_hours
  FROM pkg_steps
  GROUP BY package_id
),
job_signals AS (
  SELECT
    jq.package_id,
    count(*) FILTER (WHERE jq.status IN ('pending','queued')) AS jobs_pending,
    count(*) FILTER (WHERE jq.status IN ('processing','running','batch_pending')) AS jobs_processing,
    count(*) FILTER (WHERE jq.status = 'failed') AS jobs_failed,
    max(jq.completed_at) AS last_job_completed_at,
    count(*) FILTER (WHERE jq.status = 'completed' AND jq.completed_at > now() - interval '24 hours') AS completions_24h,
    EXTRACT(EPOCH FROM (now() - max(jq.completed_at))) / 3600 AS hours_since_last_completion
  FROM job_queue jq
  WHERE jq.package_id IS NOT NULL
  GROUP BY jq.package_id
)
SELECT
  cp.id AS package_id,
  COALESCE(vd.canonical_title, cp.title) AS title,
  cp.status,
  cp.priority,
  cp.build_progress,
  pa.total_steps::int AS total_steps,
  pa.done_steps::int AS done_steps,
  pa.running_steps::int AS running_steps,
  pa.blocked_steps::int AS blocked_steps,
  pa.failed_steps::int AS failed_steps,
  CASE WHEN pa.total_p75_hours > 0
    THEN round((pa.done_p75_hours / pa.total_p75_hours * 100)::numeric, 1)
    ELSE 0
  END AS weighted_progress_pct,
  round(pa.remaining_p75_hours::numeric, 1) AS eta_hours_sequential,
  round((pa.remaining_p75_hours * 0.45)::numeric, 1) AS eta_hours_parallel,
  pa.bottleneck_step,
  round(COALESCE(pa.bottleneck_hours, 0)::numeric, 1) AS bottleneck_hours,
  COALESCE(js.jobs_pending, 0)::int AS jobs_pending,
  COALESCE(js.jobs_processing, 0)::int AS jobs_processing,
  COALESCE(js.jobs_failed, 0)::int AS jobs_failed,
  COALESCE(js.completions_24h, 0)::int AS completions_24h,
  round(COALESCE(js.hours_since_last_completion, 999)::numeric, 1) AS hours_since_last_completion,
  CASE
    WHEN pa.failed_steps > 0 THEN 'failed_steps'
    WHEN pa.blocked_steps > 0 THEN 'blocked_steps'
    WHEN COALESCE(js.jobs_pending, 0) = 0
      AND COALESCE(js.jobs_processing, 0) = 0
      AND pa.done_steps < pa.total_steps THEN 'no_active_work'
    WHEN COALESCE(js.hours_since_last_completion, 999) > 4
      AND COALESCE(js.jobs_processing, 0) = 0 THEN 'starvation'
    ELSE 'healthy'
  END AS health_signal,
  CASE
    WHEN pa.total_p75_hours > 0 THEN
      round(LEAST(100, GREATEST(0, (
        (pa.done_p75_hours / pa.total_p75_hours * 60)
        + (GREATEST(0, 20 - COALESCE(cp.priority, 50)))
        + LEAST(20, COALESCE(js.completions_24h, 0)::numeric * 0.5)
        - CASE WHEN COALESCE(js.hours_since_last_completion, 999) > 6 THEN 15 ELSE 0 END
        - CASE WHEN pa.failed_steps > 0 THEN 10 ELSE 0 END
        - CASE WHEN pa.blocked_steps > 0 THEN 10 ELSE 0 END
      )))::numeric, 1)
    ELSE 0
  END AS publish_priority_score,
  cp.updated_at
FROM course_packages cp
JOIN pkg_agg pa ON pa.package_id = cp.id
LEFT JOIN v_course_display_ssot vd ON vd.package_id = cp.id
LEFT JOIN job_signals js ON js.package_id = cp.id
WHERE cp.status IN ('building', 'council_review')
ORDER BY
  CASE
    WHEN pa.total_p75_hours > 0
    THEN pa.done_p75_hours / pa.total_p75_hours
    ELSE 0
  END DESC,
  cp.priority ASC NULLS LAST;
