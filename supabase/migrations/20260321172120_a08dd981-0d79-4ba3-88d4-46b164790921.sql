-- Fix A+B already applied in previous migration. Only the view failed.
-- FIX D: Rebuild ops_pipeline_step_drift with new signal classes
-- council_sessions uses decided_at/created_at (no updated_at)

DROP VIEW IF EXISTS public.ops_pipeline_step_drift;

CREATE VIEW public.ops_pipeline_step_drift AS
WITH functional_steps AS (
  SELECT ps.package_id, ps.step_key, ps.status, ps.updated_at, ps.meta,
         cp.status AS pkg_status, cp.build_progress, cp.curriculum_id
  FROM package_steps ps
  JOIN course_packages cp ON cp.id = ps.package_id
  WHERE ps.status <> 'skipped'
    AND cp.status IN ('building', 'blocked', 'council_review', 'quality_gate_failed')
),
step_mapping AS (
  SELECT step_key, job_type FROM ops_jobtype_step_map
),
prereq_status AS (
  SELECT fs.package_id, fs.step_key,
    COALESCE(bool_and(pred.status = 'done'), true) AS all_prereqs_done,
    count(dag.depends_on) AS prereq_count,
    count(dag.depends_on) FILTER (WHERE pred.status = 'done') AS prereqs_done_count
  FROM functional_steps fs
  LEFT JOIN pipeline_dag_edges dag ON dag.step_key = fs.step_key
  LEFT JOIN package_steps pred ON pred.package_id = fs.package_id AND pred.step_key = dag.depends_on
  GROUP BY fs.package_id, fs.step_key
),
active_jobs AS (
  SELECT DISTINCT jq.package_id, sm2.step_key
  FROM job_queue jq
  JOIN ops_jobtype_step_map sm2 ON sm2.job_type = jq.job_type
  WHERE jq.status IN ('pending', 'processing', 'enqueued')
),
council_rollup AS (
  SELECT cs.package_id,
    count(*) AS total_sessions,
    count(*) FILTER (WHERE COALESCE(cs.status, 'pending') NOT IN ('completed', 'cancelled', 'skipped')) AS pending_sessions,
    max(COALESCE(cs.decided_at, cs.created_at)) AS last_council_activity_at
  FROM council_sessions cs
  GROUP BY cs.package_id
),
integrity_info AS (
  SELECT ps.package_id, ps.status AS integrity_status, ps.updated_at AS integrity_updated_at
  FROM package_steps ps WHERE ps.step_key = 'run_integrity_check'
),
publish_loop_guard AS (
  SELECT jq.package_id,
    count(*) FILTER (
      WHERE jq.job_type = 'package_auto_publish'
        AND jq.status = 'cancelled'
        AND jq.created_at > now() - interval '2 hours'
        AND (jq.last_error ILIKE '%loop_guard%' OR jq.last_error ILIKE '%auto_publish_blocked%')
    ) AS recent_loop_guard_cancels
  FROM job_queue jq WHERE jq.package_id IS NOT NULL
  GROUP BY jq.package_id
)
SELECT
  fs.package_id,
  fs.curriculum_id,
  fs.pkg_status,
  fs.build_progress,
  fs.step_key,
  fs.status AS step_status,
  fs.updated_at AS step_updated_at,
  fs.meta,
  sm.job_type,
  ps.all_prereqs_done,
  ps.prereq_count,
  ps.prereqs_done_count,
  aj.step_key IS NOT NULL AS has_active_job,
  COALESCE(cr.total_sessions, 0) AS council_total_sessions,
  COALESCE(cr.pending_sessions, 0) AS council_pending_sessions,
  cr.last_council_activity_at,
  ii.integrity_status,
  ii.integrity_updated_at,
  COALESCE(plg.recent_loop_guard_cancels, 0) AS recent_loop_guard_cancels,
  EXTRACT(epoch FROM now() - fs.updated_at) / 60.0 AS age_minutes,
  CASE
    WHEN fs.step_key = 'quality_council' AND fs.status = 'done'
      AND COALESCE(cr.pending_sessions, 0) > 0
      THEN 'SSOT_MISMATCH_COUNCIL_DONE_BUT_PENDING'
    WHEN fs.step_key = 'run_integrity_check' AND fs.status = 'done'
      AND cr.last_council_activity_at IS NOT NULL
      AND ii.integrity_updated_at IS NOT NULL
      AND cr.last_council_activity_at > ii.integrity_updated_at
      THEN 'INTEGRITY_STALE_AFTER_COUNCIL'
    WHEN fs.step_key = 'auto_publish' AND fs.status = 'blocked'
      AND COALESCE(plg.recent_loop_guard_cancels, 0) >= 3
      THEN 'LOOP_GUARD_BLOCKED'
    WHEN sm.job_type IS NULL THEN 'UNMAPPED_STEP'
    WHEN fs.status = 'blocked' THEN 'BLOCKED'
    WHEN fs.status = 'running' AND fs.updated_at < (now() - interval '30 minutes')
      THEN 'ZOMBIE_RUNNING'
    WHEN fs.status = 'enqueued' AND fs.updated_at < (now() - interval '1 hour')
      THEN 'STALE_ENQUEUED'
    WHEN fs.status = 'queued' AND ps.all_prereqs_done AND aj.step_key IS NULL
      AND fs.updated_at < (now() - interval '15 minutes')
      THEN 'TRUE_STALL'
    WHEN fs.status = 'queued' AND NOT ps.all_prereqs_done
      THEN 'WAITING_PREREQS'
    WHEN aj.step_key IS NOT NULL AND NOT ps.all_prereqs_done
      THEN 'PREMATURE_JOB_DISPATCH'
    WHEN fs.status = 'queued' AND ps.all_prereqs_done AND aj.step_key IS NOT NULL
      THEN 'DISPATCHING'
    WHEN fs.status = 'queued' AND ps.all_prereqs_done AND aj.step_key IS NULL
      THEN 'PENDING_DISPATCH'
    ELSE 'OK'
  END AS drift_signal
FROM functional_steps fs
LEFT JOIN step_mapping sm ON sm.step_key = fs.step_key
LEFT JOIN prereq_status ps ON ps.package_id = fs.package_id AND ps.step_key = fs.step_key
LEFT JOIN active_jobs aj ON aj.package_id = fs.package_id AND aj.step_key = fs.step_key
LEFT JOIN council_rollup cr ON cr.package_id = fs.package_id
LEFT JOIN integrity_info ii ON ii.package_id = fs.package_id
LEFT JOIN publish_loop_guard plg ON plg.package_id = fs.package_id
WHERE fs.status <> 'done'
ORDER BY
  CASE
    WHEN fs.step_key = 'quality_council' AND fs.status = 'done' AND COALESCE(cr.pending_sessions, 0) > 0 THEN 0
    WHEN sm.job_type IS NULL THEN 1
    WHEN fs.status = 'queued' AND ps.all_prereqs_done AND aj.step_key IS NULL AND fs.updated_at < (now() - interval '15 minutes') THEN 2
    WHEN fs.status = 'blocked' THEN 3
    WHEN fs.status = 'running' AND fs.updated_at < (now() - interval '30 minutes') THEN 4
    ELSE 10
  END,
  fs.updated_at