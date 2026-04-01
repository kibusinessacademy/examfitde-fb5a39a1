
-- 1. Fix enqueue_integrity_rechecks: use snake_case package_id in payload
CREATE OR REPLACE FUNCTION public.enqueue_integrity_rechecks(p_cap integer DEFAULT 150, p_reason text DEFAULT 'manual'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cap int := GREATEST(10, LEAST(COALESCE(p_cap,150), 500));
  v_inserted int := 0;
  v_candidates int := 0;
  v_current_version int;
BEGIN
  v_current_version := current_integrity_report_version_num();

  WITH candidates AS (
    SELECT cp.id, cp.curriculum_id
    FROM public.course_packages cp
    WHERE
      cp.status IN ('building', 'done', 'published', 'draft')
      AND (
        cp.integrity_report IS NULL
        OR COALESCE(cp.integrity_report_version_num, 0) < v_current_version
        OR (cp.status = 'quality_gate_failed' AND cp.track = 'EXAM_FIRST')
      )
    ORDER BY cp.updated_at DESC
    LIMIT v_cap
  ),
  ins AS (
    INSERT INTO public.job_queue (job_type, status, payload, package_id, worker_pool, priority, max_attempts)
    SELECT
      'package_run_integrity_check',
      'pending',
      jsonb_build_object(
        'package_id', c.id::text,
        'curriculum_id', c.curriculum_id::text,
        'reason', p_reason
      ),
      c.id,
      'core',
      70,
      3
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.job_queue jq
      WHERE jq.job_type = 'package_run_integrity_check'
        AND jq.status IN ('pending')
        AND (jq.payload->>'package_id' = c.id::text OR jq.payload->>'packageId' = c.id::text)
    )
    RETURNING 1
  )
  SELECT
    (SELECT COUNT(*) FROM candidates),
    (SELECT COUNT(*) FROM ins)
  INTO v_candidates, v_inserted;

  RETURN jsonb_build_object(
    'cap', v_cap,
    'candidates', v_candidates,
    'enqueued', v_inserted,
    'current_version', v_current_version
  );
END;
$function$;

-- 2. Fix consistency trigger to also clear integrity_report_version_num
CREATE OR REPLACE FUNCTION public.fn_guard_integrity_report_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.integrity_report_version IS NOT NULL AND NEW.integrity_report IS NULL THEN
    IF OLD.integrity_report IS NOT NULL AND NEW.integrity_report IS NULL THEN
      NEW.integrity_report_version := NULL;
      NEW.integrity_report_version_num := 0;
      NEW.integrity_passed := false;

      UPDATE public.package_steps
      SET status = 'queued',
          started_at = NULL,
          finished_at = NULL,
          updated_at = now(),
          last_error = 'AUTO_REQUEUE: integrity_report stripped but version remained',
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'integrity_consistency_guard_at', now(),
            'integrity_auto_requeue_at', now()::text
          )
      WHERE package_id = NEW.id
        AND step_key = 'run_integrity_check'
        AND status IN ('done', 'failed');
    ELSIF OLD.integrity_report_version IS NULL THEN
      NEW.integrity_report_version := NULL;
      NEW.integrity_report_version_num := 0;
      NEW.integrity_passed := false;
    END IF;
  END IF;

  -- Also guard: version_num set but report NULL (covers cases where text version was already cleared)
  IF NEW.integrity_report IS NULL AND COALESCE(NEW.integrity_report_version_num, 0) > 0 THEN
    NEW.integrity_report_version_num := 0;
    NEW.integrity_passed := false;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Reset failed MATERIALIZATION_GUARD integrity jobs
UPDATE job_queue
SET status = 'pending', attempts = 0, last_error = NULL, locked_at = NULL, locked_by = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"materialization_retries": 0, "reset_reason": "job_runner_branch_fix"}'::jsonb
WHERE job_type = 'package_run_integrity_check'
  AND status IN ('failed')
  AND last_error LIKE '%MATERIALIZATION_GUARD%';

-- 4. Fix orphaned version_num without report (Elektroniker, Kaufmann, etc.)
UPDATE course_packages
SET integrity_report_version_num = 0, integrity_passed = false
WHERE integrity_report IS NULL AND COALESCE(integrity_report_version_num, 0) > 0;

-- 5. Normalize camelCase payload in existing pending jobs
UPDATE job_queue
SET payload = payload - 'packageId' || jsonb_build_object('package_id', payload->>'packageId')
WHERE job_type = 'package_run_integrity_check'
  AND status = 'pending'
  AND payload ? 'packageId'
  AND NOT payload ? 'package_id';
