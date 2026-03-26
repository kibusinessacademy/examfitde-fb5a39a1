
-- =============================================================
-- FIX: SSOT-align step counters in views to match
-- recompute_package_progress() denominator:
--   numerator = count(done)
--   denominator = count(status <> 'skipped')
-- =============================================================

-- 1) v_building_package_eta
DROP VIEW IF EXISTS public.v_building_package_eta;
CREATE VIEW public.v_building_package_eta AS
WITH step_weights AS (
  SELECT t.step_key, t.p75_hours
  FROM ( VALUES 
    ('scaffold_learning_course',0.18), ('generate_glossary',0.06), ('fanout_learning_content',0.10),
    ('generate_learning_content',1.80), ('finalize_learning_content',2.00), ('validate_learning_content',0.96),
    ('auto_seed_exam_blueprints',0.18), ('validate_blueprints',0.15), ('generate_exam_pool',8.93),
    ('validate_exam_pool',0.10), ('generate_lesson_minichecks',7.27), ('validate_lesson_minichecks',0.05),
    ('generate_handbook',0.10), ('validate_handbook',0.05), ('enqueue_handbook_expand',0.05),
    ('expand_handbook',6.93), ('validate_handbook_depth',9.28), ('generate_oral_exam',0.50),
    ('validate_oral_exam',0.10), ('build_ai_tutor_index',0.10), ('validate_tutor_index',0.05),
    ('elite_harden',2.00), ('quality_council',1.00), ('run_integrity_check',0.20), ('auto_publish',0.05),
    ('generate_curriculum',0.10), ('generate_modules',0.10), ('generate_lessons',0.10),
    ('generate_lesson_content',1.80), ('generate_exam_questions',4.00), ('validate_exam_questions',0.50),
    ('generate_handbook_content',2.00), ('validate_handbook_content',0.50), ('generate_oral_exam_content',2.00),
    ('validate_oral_exam_content',0.50), ('generate_tutor_index',0.10), ('setup_course_package',0.05),
    ('setup_storefront',0.10), ('launch_marketing',0.10), ('post_launch_monitor',0.10), ('council_review',1.00)
  ) t(step_key, p75_hours)
), pkg_steps AS (
  SELECT ps.package_id, ps.step_key, ps.status::text AS step_status, ps.updated_at
  FROM package_steps ps
), pkg_agg AS (
  SELECT
    pkg_steps.package_id,
    count(*) FILTER (WHERE pkg_steps.step_status <> 'skipped') AS total_steps,
    count(*) FILTER (WHERE pkg_steps.step_status = 'done') AS done_steps,
    count(*) FILTER (WHERE pkg_steps.step_status = 'running') AS running_steps,
    count(*) FILTER (WHERE pkg_steps.step_status = 'blocked') AS blocked_steps,
    count(*) FILTER (WHERE pkg_steps.step_status = 'failed') AS failed_steps,
    sum(COALESCE(sw.p75_hours, 0.20)) FILTER (WHERE pkg_steps.step_status NOT IN ('done','skipped')) AS remaining_hours,
    sum(COALESCE(sw.p75_hours, 0.20)) AS total_hours,
    sum(COALESCE(sw.p75_hours, 0.20)) FILTER (WHERE pkg_steps.step_status IN ('done','skipped')) AS completed_hours,
    max(pkg_steps.updated_at) FILTER (WHERE pkg_steps.step_status = 'done') AS last_completion_at
  FROM pkg_steps
  LEFT JOIN step_weights sw ON sw.step_key = pkg_steps.step_key
  GROUP BY pkg_steps.package_id
), job_agg AS (
  SELECT
    jq.package_id,
    count(*) FILTER (WHERE jq.status IN ('pending','queued')) AS jobs_pending,
    count(*) FILTER (WHERE jq.status IN ('processing','running','batch_pending')) AS jobs_processing,
    count(*) FILTER (WHERE jq.status = 'failed') AS jobs_failed,
    max(jq.completed_at) FILTER (WHERE jq.status = 'completed') AS last_job_completed,
    count(*) FILTER (WHERE jq.status = 'completed' AND jq.completed_at > now() - interval '24 hours') AS completions_24h
  FROM job_queue jq
  WHERE jq.package_id IS NOT NULL
  GROUP BY jq.package_id
)
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status,
  cp.priority,
  cp.build_progress,
  pa.total_steps::integer AS total_steps,
  pa.done_steps::integer AS done_steps,
  pa.running_steps::integer AS running_steps,
  pa.blocked_steps::integer AS blocked_steps,
  pa.failed_steps::integer AS failed_steps,
  CASE WHEN COALESCE(pa.total_hours, 0) > 0
    THEN round(COALESCE(pa.completed_hours, 0) / pa.total_hours * 100, 1)
    ELSE 0 END::numeric AS weighted_progress_pct,
  round(COALESCE(pa.remaining_hours, 0), 1)::numeric AS eta_hours_sequential,
  round(COALESCE(pa.remaining_hours, 0) * 0.45, 1)::numeric AS eta_hours_parallel,
  NULL::text AS bottleneck_step,
  0::numeric AS bottleneck_hours,
  COALESCE(js.jobs_pending, 0)::integer AS jobs_pending,
  COALESCE(js.jobs_processing, 0)::integer AS jobs_processing,
  COALESCE(js.jobs_failed, 0)::integer AS jobs_failed,
  COALESCE(js.completions_24h, 0)::integer AS completions_24h,
  CASE WHEN pa.last_completion_at IS NOT NULL
    THEN round(extract(epoch FROM now() - GREATEST(pa.last_completion_at, COALESCE(js.last_job_completed, '2000-01-01'::timestamptz))) / 3600.0, 1)
    ELSE 999 END::numeric AS hours_since_last_completion,
  CASE
    WHEN pa.failed_steps > 0 THEN 'has_failures'
    WHEN pa.blocked_steps > 0 THEN 'has_blocked'
    WHEN COALESCE(js.jobs_pending, 0) = 0 AND COALESCE(js.jobs_processing, 0) = 0 AND pa.done_steps < pa.total_steps THEN 'no_active_work'
    WHEN COALESCE(js.jobs_processing, 0) > 0 THEN 'active'
    ELSE 'idle'
  END AS health_signal,
  (COALESCE(cp.priority, 50) * 2 +
   CASE WHEN pa.total_steps > 0 THEN (pa.done_steps * 100 / pa.total_steps) ELSE 0 END +
   CASE WHEN pa.failed_steps > 0 THEN -30 ELSE 0 END +
   CASE WHEN COALESCE(js.completions_24h, 0) > 0 THEN 20 ELSE 0 END
  )::integer AS publish_priority_score
FROM course_packages cp
JOIN pkg_agg pa ON pa.package_id = cp.id
LEFT JOIN job_agg js ON js.package_id = cp.id
WHERE cp.status IN ('building','blocked','quality_gate_failed');


-- 2) v_pipeline_repair_classification
DROP VIEW IF EXISTS public.v_pipeline_repair_classification;
CREATE VIEW public.v_pipeline_repair_classification AS
WITH step_state AS (
  SELECT
    ps.package_id,
    count(*) FILTER (WHERE ps.status = 'done') AS done_steps,
    count(*) FILTER (WHERE ps.status <> 'skipped') AS total_steps,
    max(CASE WHEN ps.step_key = 'generate_learning_content' THEN ps.status::text END) AS gen_status,
    max(CASE WHEN ps.step_key = 'validate_learning_content' THEN ps.status::text END) AS val_status,
    max(CASE WHEN ps.step_key = 'generate_learning_content' THEN ps.updated_at END) AS gen_updated_at
  FROM package_steps ps
  GROUP BY ps.package_id
), job_state AS (
  SELECT
    jq.package_id AS pkg_id,
    count(*) FILTER (WHERE jq.job_type = 'lesson_generate_content_shard' AND jq.status = 'completed') AS shard_completed,
    count(*) FILTER (WHERE jq.job_type = 'lesson_generate_content_shard' AND jq.status = 'failed') AS shard_failed,
    count(*) FILTER (WHERE jq.job_type = 'lesson_generate_content' AND jq.status = 'completed') AS legacy_content_completed,
    count(*) FILTER (WHERE jq.job_type = 'package_finalize_learning_content' AND jq.status = 'completed') AS finalizer_completed,
    count(*) FILTER (WHERE jq.job_type = 'package_finalize_learning_content' AND jq.status IN ('pending','queued','processing','running')) AS finalizer_active,
    count(*) FILTER (WHERE jq.job_type = 'package_finalize_learning_content' AND jq.status = 'failed') AS finalizer_failed,
    max(jq.completed_at) FILTER (WHERE jq.job_type IN ('lesson_generate_content','lesson_generate_content_shard') AND jq.status = 'completed') AS last_content_job_at
  FROM job_queue jq
  WHERE jq.package_id IS NOT NULL
  GROUP BY jq.package_id
)
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status,
  cp.build_progress AS stored_progress,
  ss.done_steps,
  ss.total_steps,
  round(ss.done_steps::numeric / NULLIF(ss.total_steps, 0)::numeric * 100, 0)::integer AS real_progress,
  (cp.build_progress - round(ss.done_steps::numeric / NULLIF(ss.total_steps, 0)::numeric * 100, 0))::integer AS drift,
  ss.gen_status,
  ss.val_status,
  COALESCE(js.shard_completed, 0) AS shard_completed,
  COALESCE(js.shard_failed, 0) AS shard_failed,
  COALESCE(js.legacy_content_completed, 0) AS legacy_content_completed,
  COALESCE(js.finalizer_completed, 0) AS finalizer_completed,
  COALESCE(js.finalizer_active, 0) AS finalizer_active,
  COALESCE(js.finalizer_failed, 0) AS finalizer_failed,
  js.last_content_job_at,
  CASE
    WHEN round(ss.done_steps::numeric / NULLIF(ss.total_steps, 0)::numeric * 100, 0) >= (cp.build_progress - 3) THEN 'A_HEALTHY'
    WHEN ss.gen_status = 'done' AND ss.val_status = 'done' THEN 'A_HEALTHY'
    WHEN COALESCE(js.shard_failed, 0) > 0 AND COALESCE(js.shard_completed, 0) = 0 THEN 'C_SHARD_DEFECT'
    WHEN COALESCE(js.finalizer_failed, 0) > 0 AND COALESCE(js.finalizer_completed, 0) = 0 THEN 'D_FINALIZER_FAIL'
    WHEN COALESCE(js.shard_completed, 0) > 0 AND COALESCE(js.finalizer_completed, 0) = 0 AND COALESCE(js.finalizer_active, 0) = 0 THEN 'E_MISSING_FINALIZER'
    WHEN ss.gen_status IN ('queued','pending','running') THEN 'B_IN_PROGRESS'
    ELSE 'F_UNKNOWN'
  END AS repair_class
FROM course_packages cp
JOIN step_state ss ON ss.package_id = cp.id
LEFT JOIN job_state js ON js.pkg_id = cp.id
WHERE cp.status NOT IN ('archived','draft','published','done');
