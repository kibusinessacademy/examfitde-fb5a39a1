
-- 1. DAG-aware healer: replaces hardcoded logic with real pipeline_dag_edges
CREATE OR REPLACE FUNCTION public.fn_heal_queued_steps_without_jobs(
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  package_id uuid,
  step_key text,
  job_type text,
  action text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_job_type text;
  v_existing_job_count int;
  v_unmet_deps int;
BEGIN
  FOR rec IN
    SELECT ps.package_id, ps.step_key, cp.status AS pkg_status, cp.curriculum_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'
      AND cp.status IN ('building', 'quality_gate_failed')
      AND ps.updated_at < now() - interval '10 minutes'
  LOOP
    v_job_type := 'package_' || rec.step_key;

    -- Check no active job exists
    SELECT count(*) INTO v_existing_job_count
    FROM job_queue jq
    WHERE jq.package_id = rec.package_id
      AND jq.job_type = v_job_type
      AND jq.status IN ('pending', 'queued', 'processing', 'running', 'batch_pending');

    IF v_existing_job_count > 0 THEN
      CONTINUE;
    END IF;

    -- DAG check: all upstream dependencies must be done or skipped
    SELECT count(*) INTO v_unmet_deps
    FROM pipeline_dag_edges pde
    JOIN package_steps upstream_ps
      ON upstream_ps.package_id = rec.package_id
     AND upstream_ps.step_key = pde.depends_on
    WHERE pde.step_key = rec.step_key
      AND upstream_ps.status NOT IN ('done', 'skipped');

    -- Also check if there are DAG edges referencing steps that don't exist in package_steps
    -- (missing step rows = unmet dependency)
    v_unmet_deps := v_unmet_deps + (
      SELECT count(*)
      FROM pipeline_dag_edges pde
      WHERE pde.step_key = rec.step_key
        AND NOT EXISTS (
          SELECT 1 FROM package_steps ups
          WHERE ups.package_id = rec.package_id
            AND ups.step_key = pde.depends_on
            AND ups.status IN ('done', 'skipped')
        )
    );

    IF v_unmet_deps > 0 THEN
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      package_id := rec.package_id;
      step_key := rec.step_key;
      job_type := v_job_type;
      action := 'would_enqueue';
      RETURN NEXT;
    ELSE
      PERFORM enqueue_job_if_absent(
        v_job_type,
        rec.package_id,
        jsonb_build_object('package_id', rec.package_id, 'curriculum_id', rec.curriculum_id),
        20,
        3,
        now()
      );

      INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('queued_step_no_job_heal', 'fn_heal_queued_steps_without_jobs', 'package_step', rec.package_id::text, 'healed',
              'Enqueued missing job for queued step ' || rec.step_key,
              jsonb_build_object('package_id', rec.package_id, 'step_key', rec.step_key, 'job_type', v_job_type));

      package_id := rec.package_id;
      step_key := rec.step_key;
      job_type := v_job_type;
      action := 'enqueued';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- 2. Invariant view: queued steps without active jobs (regression monitor)
CREATE OR REPLACE VIEW public.ops_queued_step_without_job AS
SELECT
  ps.package_id,
  ps.step_key,
  'package_' || ps.step_key AS expected_job_type,
  ps.status AS step_status,
  ps.updated_at AS queued_since,
  now() - ps.updated_at AS queued_duration,
  cp.status AS package_status,
  -- DAG readiness: are all upstream deps met?
  (
    NOT EXISTS (
      SELECT 1
      FROM pipeline_dag_edges pde
      WHERE pde.step_key = ps.step_key
        AND NOT EXISTS (
          SELECT 1 FROM package_steps ups
          WHERE ups.package_id = ps.package_id
            AND ups.step_key = pde.depends_on
            AND ups.status IN ('done', 'skipped')
        )
    )
  ) AS dag_ready,
  -- Does an active job exist?
  EXISTS (
    SELECT 1 FROM job_queue jq
    WHERE jq.package_id = ps.package_id
      AND jq.job_type = 'package_' || ps.step_key
      AND jq.status IN ('pending', 'queued', 'processing', 'running', 'batch_pending')
  ) AS has_active_job
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
WHERE ps.status = 'queued'
  AND cp.status IN ('building', 'quality_gate_failed')
  AND ps.updated_at < now() - interval '10 minutes';

COMMENT ON VIEW ops_queued_step_without_job IS
'Invariant monitor: shows queued pipeline steps without an active job. Rows with dag_ready=true AND has_active_job=false indicate a dispatch gap.';
