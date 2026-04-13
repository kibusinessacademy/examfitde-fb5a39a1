
-- 1. Harden fn_heal_queued_steps_without_jobs: exclude governance steps
CREATE OR REPLACE FUNCTION public.fn_heal_queued_steps_without_jobs(p_dry_run boolean DEFAULT true)
RETURNS TABLE(package_id uuid, step_key text, job_type text, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_job_type text;
  v_existing_job_count int;
  v_has_unmet_deps boolean;
  -- GOVERNANCE ISOLATION: These steps must ONLY be enqueued by their own edge functions
  v_governance_steps text[] := ARRAY['run_integrity_check', 'quality_council', 'auto_publish'];
BEGIN
  FOR rec IN
    SELECT ps.package_id, ps.step_key, cp.status AS pkg_status, cp.curriculum_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'
      AND cp.status IN ('building', 'quality_gate_failed')
      AND ps.updated_at < now() - interval '10 minutes'
      -- GOVERNANCE EXCLUSION: never auto-heal governance steps
      AND ps.step_key <> ALL(v_governance_steps)
  LOOP
    -- SSOT lookup: use step_job_mapping first, fallback to package_ prefix
    SELECT sjm.job_types[1] INTO v_job_type
    FROM step_job_mapping sjm
    WHERE sjm.step_key = rec.step_key
      AND array_length(sjm.job_types, 1) > 0;

    IF v_job_type IS NULL THEN
      v_job_type := 'package_' || rec.step_key;
    END IF;

    -- Check no active job exists
    SELECT count(*) INTO v_existing_job_count
    FROM job_queue jq
    WHERE jq.package_id = rec.package_id
      AND jq.job_type = v_job_type
      AND jq.status IN ('pending', 'queued', 'processing', 'running', 'batch_pending');

    IF v_existing_job_count > 0 THEN
      CONTINUE;
    END IF;

    -- DAG check: every upstream dependency must be done/skipped
    SELECT EXISTS (
      SELECT 1
      FROM pipeline_dag_edges pde
      WHERE pde.step_key = rec.step_key
        AND NOT EXISTS (
          SELECT 1 FROM package_steps ups
          WHERE ups.package_id = rec.package_id
            AND ups.step_key = pde.depends_on
            AND ups.status IN ('done', 'skipped')
        )
    ) INTO v_has_unmet_deps;

    IF v_has_unmet_deps THEN
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

-- 2. Cancel all processing integrity check jobs (freeing runner slots)
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'GOVERNANCE_CLEANUP: cancelled to free runner slots — premature integrity check on incomplete packages',
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'governance_isolation_cleanup',
      'cancel_source', 'migration_governance_v2',
      'cancelled_at', now()::text
    ),
    updated_at = now(),
    locked_at = null,
    locked_by = null
WHERE job_type = 'package_run_integrity_check'
  AND status IN ('processing', 'pending');

-- 3. Cancel quality_council and auto_publish jobs for packages where integrity hasn't passed
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'GOVERNANCE_CLEANUP: integrity_passed=false, premature governance job',
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'premature_governance',
      'cancel_source', 'migration_governance_v2'
    ),
    updated_at = now(),
    locked_at = null,
    locked_by = null
WHERE job_type IN ('package_quality_council', 'package_auto_publish')
  AND status IN ('processing', 'pending')
  AND package_id IN (
    SELECT id FROM course_packages WHERE integrity_passed IS NOT TRUE
  );

-- 4. WIP enforcement: demote excess building packages to blocked
-- Keep only the top 18 by priority, set the rest to blocked
WITH ranked AS (
  SELECT id, priority, 
    ROW_NUMBER() OVER (ORDER BY priority ASC, updated_at ASC) as rn
  FROM course_packages
  WHERE status = 'building'
),
excess AS (
  SELECT id FROM ranked WHERE rn > 18
)
UPDATE course_packages
SET status = 'blocked',
    blocked_reason = 'intentional_pause',
    updated_at = now()
FROM excess
WHERE course_packages.id = excess.id;

-- Cancel pending/processing jobs for the newly-blocked packages
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'WIP_ENFORCEMENT: package demoted to blocked (over WIP cap)',
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'wip_cap_exceeded',
      'cancel_source', 'migration_governance_v2'
    ),
    updated_at = now(),
    locked_at = null,
    locked_by = null
WHERE status IN ('pending', 'processing')
  AND package_id IN (
    SELECT id FROM course_packages WHERE status = 'blocked' AND blocked_reason = 'intentional_pause'
  );

-- 5. Audit log
INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
VALUES (
  'governance_isolation_v2',
  'migration',
  'system',
  NULL,
  'applied',
  'Governance-Step-Isolation v2: excluded governance from healer, cancelled premature jobs, enforced WIP cap',
  jsonb_build_object('fixes', ARRAY[
    'fn_heal_queued_steps_without_jobs governance exclusion',
    'cancelled processing integrity checks',
    'cancelled premature governance jobs',
    'enforced WIP cap (18 max building)'
  ])
);
