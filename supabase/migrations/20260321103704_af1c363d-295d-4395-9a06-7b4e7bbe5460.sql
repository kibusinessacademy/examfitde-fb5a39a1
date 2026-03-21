
-- 1) Create DAG edges table
CREATE TABLE IF NOT EXISTS public.pipeline_dag_edges (
  step_key text NOT NULL,
  depends_on text NOT NULL,
  PRIMARY KEY (step_key, depends_on)
);

TRUNCATE public.pipeline_dag_edges;
INSERT INTO public.pipeline_dag_edges (step_key, depends_on) VALUES
  ('generate_glossary', 'scaffold_learning_course'),
  ('fanout_learning_content', 'scaffold_learning_course'),
  ('generate_learning_content', 'fanout_learning_content'),
  ('finalize_learning_content', 'generate_learning_content'),
  ('validate_learning_content', 'finalize_learning_content'),
  ('auto_seed_exam_blueprints', 'validate_learning_content'),
  ('validate_blueprints', 'auto_seed_exam_blueprints'),
  ('generate_exam_pool', 'validate_blueprints'),
  ('validate_exam_pool', 'generate_exam_pool'),
  ('build_ai_tutor_index', 'validate_exam_pool'),
  ('validate_tutor_index', 'build_ai_tutor_index'),
  ('generate_oral_exam', 'validate_tutor_index'),
  ('validate_oral_exam', 'generate_oral_exam'),
  ('generate_lesson_minichecks', 'validate_learning_content'),
  ('validate_lesson_minichecks', 'generate_lesson_minichecks'),
  ('generate_handbook', 'validate_learning_content'),
  ('validate_handbook', 'generate_handbook'),
  ('enqueue_handbook_expand', 'validate_handbook'),
  ('expand_handbook', 'enqueue_handbook_expand'),
  ('validate_handbook_depth', 'expand_handbook'),
  ('elite_harden', 'validate_exam_pool'),
  ('run_integrity_check', 'elite_harden'),
  ('run_integrity_check', 'validate_lesson_minichecks'),
  ('run_integrity_check', 'validate_handbook_depth'),
  ('run_integrity_check', 'validate_oral_exam'),
  ('run_integrity_check', 'validate_tutor_index'),
  ('quality_council', 'run_integrity_check'),
  ('auto_publish', 'quality_council');

-- 2) Drop + recreate prereq-aware drift view
DROP VIEW IF EXISTS public.ops_pipeline_step_drift;

CREATE VIEW public.ops_pipeline_step_drift AS
WITH functional_steps AS (
  SELECT ps.package_id, ps.step_key, ps.status, ps.updated_at,
    cp.status AS pkg_status, cp.build_progress
  FROM package_steps ps
  JOIN course_packages cp ON cp.id = ps.package_id
  WHERE ps.status != 'skipped'
    AND cp.status IN ('building', 'blocked', 'council_review', 'quality_gate_failed')
),
step_mapping AS (
  SELECT step_key, job_type FROM ops_jobtype_step_map
),
prereq_status AS (
  SELECT
    fs.package_id, fs.step_key,
    COALESCE(bool_and(pred.status = 'done'), true) AS all_prereqs_done,
    COUNT(dag.depends_on) AS prereq_count,
    COUNT(dag.depends_on) FILTER (WHERE pred.status = 'done') AS prereqs_done_count
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
)
SELECT
  fs.package_id, fs.pkg_status, fs.build_progress, fs.step_key,
  fs.status AS step_status, fs.updated_at AS step_updated_at, sm.job_type,
  ps.all_prereqs_done, ps.prereq_count, ps.prereqs_done_count,
  aj.step_key IS NOT NULL AS has_active_job,
  CASE
    WHEN sm.job_type IS NULL THEN 'UNMAPPED_STEP'
    WHEN fs.status = 'blocked' THEN 'BLOCKED'
    WHEN fs.status = 'running' AND fs.updated_at < now() - interval '30 minutes' THEN 'ZOMBIE_RUNNING'
    WHEN fs.status = 'enqueued' AND fs.updated_at < now() - interval '1 hour' THEN 'STALE_ENQUEUED'
    WHEN fs.status = 'queued' AND ps.all_prereqs_done AND aj.step_key IS NULL
      AND fs.updated_at < now() - interval '2 hours' THEN 'TRUE_STALL'
    WHEN fs.status = 'queued' AND NOT ps.all_prereqs_done THEN 'WAITING_PREREQS'
    WHEN fs.status = 'queued' AND ps.all_prereqs_done AND aj.step_key IS NOT NULL THEN 'DISPATCHING'
    WHEN fs.status = 'queued' AND ps.all_prereqs_done AND aj.step_key IS NULL THEN 'PENDING_DISPATCH'
    ELSE 'OK'
  END AS drift_signal,
  EXTRACT(EPOCH FROM (now() - fs.updated_at)) / 60.0 AS age_minutes
FROM functional_steps fs
LEFT JOIN step_mapping sm ON sm.step_key = fs.step_key
LEFT JOIN prereq_status ps ON ps.package_id = fs.package_id AND ps.step_key = fs.step_key
LEFT JOIN active_jobs aj ON aj.package_id = fs.package_id AND aj.step_key = fs.step_key
WHERE fs.status NOT IN ('done')
ORDER BY
  CASE
    WHEN sm.job_type IS NULL THEN 0
    WHEN fs.status = 'queued' AND ps.all_prereqs_done AND aj.step_key IS NULL AND fs.updated_at < now() - interval '2 hours' THEN 1
    WHEN fs.status = 'blocked' THEN 2
    WHEN fs.status = 'running' AND fs.updated_at < now() - interval '30 minutes' THEN 3
    ELSE 10
  END,
  fs.updated_at ASC;

-- 3) Auto-heal RPC
CREATE OR REPLACE FUNCTION public.heal_true_stall_steps(p_max_heal int DEFAULT 5)
RETURNS TABLE(package_id uuid, step_key text, job_type text, action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT d.package_id, d.step_key, d.job_type
    FROM ops_pipeline_step_drift d
    WHERE d.drift_signal = 'TRUE_STALL' AND d.job_type IS NOT NULL
    ORDER BY d.age_minutes DESC
    LIMIT p_max_heal
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = rec.package_id AND jq.job_type = rec.job_type
        AND jq.status IN ('pending', 'processing', 'enqueued')
    ) THEN
      UPDATE package_steps SET status = 'enqueued', updated_at = now()
      WHERE package_steps.package_id = rec.package_id
        AND package_steps.step_key = rec.step_key AND package_steps.status = 'queued';

      INSERT INTO job_queue (package_id, job_type, status, priority, meta)
      VALUES (rec.package_id, rec.job_type, 'pending', 50,
        jsonb_build_object('healed_by', 'heal_true_stall_steps', 'healed_at', now()::text));

      INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('true_stall_heal', 'heal_true_stall_steps', 'package_step',
        rec.package_id::text || '/' || rec.step_key, 'applied',
        'Re-enqueued ' || rec.job_type || ' for stalled ' || rec.step_key,
        jsonb_build_object('package_id', rec.package_id, 'step_key', rec.step_key, 'job_type', rec.job_type));

      package_id := rec.package_id;
      step_key := rec.step_key;
      job_type := rec.job_type;
      action := 'healed';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$fn$;

NOTIFY pgrst, 'reload schema';
