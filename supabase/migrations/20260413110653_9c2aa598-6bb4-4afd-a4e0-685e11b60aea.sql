
-- ═══════════════════════════════════════════════════════════════
-- P0: CAS Guard — prevent terminal status regression
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_guard_terminal_status_regression()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Terminal states: completed, failed, cancelled
  -- Non-terminal states: pending, processing, batch_pending, queued, running
  -- Rule: once a job reaches a terminal state, it CANNOT go back to non-terminal
  IF OLD.status IN ('completed', 'failed', 'cancelled')
    AND NEW.status IN ('pending', 'processing', 'batch_pending', 'queued', 'running')
  THEN
    -- Log the blocked regression for forensics
    BEGIN
      PERFORM fn_log_guardrail_event(
        'terminal_status_regression_blocked',
        jsonb_build_object(
          'job_id', OLD.id,
          'job_type', OLD.job_type,
          'old_status', OLD.status,
          'new_status', NEW.status,
          'package_id', OLD.package_id,
          'blocked_at', now()
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- Never let logging block the guard
      NULL;
    END;

    -- Silently keep old status (don't raise, just prevent the change)
    NEW.status := OLD.status;
    NEW.completed_at := OLD.completed_at;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on BEFORE UPDATE — fires before any status change
DROP TRIGGER IF EXISTS trg_guard_terminal_status_regression ON public.job_queue;
CREATE TRIGGER trg_guard_terminal_status_regression
  BEFORE UPDATE OF status ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_terminal_status_regression();


-- ═══════════════════════════════════════════════════════════════
-- P1: Fix step-done trigger — do NOT cancel processing jobs
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_cancel_orphan_jobs_on_step_done()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_types text[];
  v_cancelled int;
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    SELECT job_types INTO v_job_types
    FROM step_job_mapping
    WHERE step_key = NEW.step_key;

    IF v_job_types IS NULL OR array_length(v_job_types, 1) IS NULL THEN
      RETURN NEW;
    END IF;

    -- CRITICAL FIX: Only cancel 'pending' jobs, NOT 'processing' ones.
    -- Processing jobs are actively being worked on by a runner and must
    -- be allowed to complete naturally. Cancelling them mid-execution
    -- causes the runner to write status back to completed/failed, but
    -- the CAS guard then blocks the write → ghost jobs.
    UPDATE job_queue
    SET status = 'cancelled',
        last_error = 'step_finalized_job_obsoleted',
        completed_at = now(),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'cancel_reason', 'step_finalized',
          'cancel_source', 'trg_cancel_orphan_jobs_on_step_done',
          'step_key', NEW.step_key
        )
    WHERE package_id = NEW.package_id
      AND job_type = ANY(v_job_types)
      AND status IN ('pending');  -- NOT 'processing'!

    GET DIAGNOSTICS v_cancelled = ROW_COUNT;

    IF v_cancelled > 0 THEN
      INSERT INTO auto_heal_log (
        action_type, trigger_source, target_type, target_id,
        result_status, result_detail, metadata
      ) VALUES (
        'cancel_orphan_jobs_on_step_done',
        'trg_cancel_orphan_jobs_on_step_done',
        'package',
        NEW.package_id,
        'success',
        format('Cancelled %s orphaned PENDING jobs for step %s (processing jobs preserved)', v_cancelled, NEW.step_key),
        jsonb_build_object(
          'step_key', NEW.step_key,
          'cancelled_count', v_cancelled,
          'job_types', v_job_types,
          'processing_preserved', true
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- P2: Non-building reaper — whitelist quality_gate_failed + add meta
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_reap_non_building_pending_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cancelled int := 0;
  v_details jsonb[] := ARRAY[]::jsonb[];
  rec record;
BEGIN
  FOR rec IN
    SELECT jq.id, jq.job_type, jq.package_id, cp.status AS pkg_status
    FROM job_queue jq
    JOIN course_packages cp ON cp.id = jq.package_id
    LEFT JOIN job_type_policies jtp ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      -- P2 FIX: Also whitelist quality_gate_failed (needs repair jobs to recover)
      AND cp.status NOT IN ('building', 'publish_failed', 'quality_gate_failed')
      AND NOT COALESCE(jtp.can_run_when_not_building, false)
      AND jq.created_at < now() - interval '5 minutes'
    ORDER BY jq.created_at ASC
    LIMIT 200
  LOOP
    UPDATE job_queue
    SET status = 'cancelled',
        last_error = format('REAPED_NON_BUILDING: package status=%s', rec.pkg_status),
        updated_at = now(),
        -- P3: Cancel taxonomy
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'cancel_reason', 'reaped_non_building',
          'cancel_source', 'fn_reap_non_building_pending_jobs',
          'pkg_status', rec.pkg_status
        )
    WHERE id = rec.id;

    v_cancelled := v_cancelled + 1;
    v_details := v_details || jsonb_build_object(
      'job_id', rec.id,
      'job_type', rec.job_type,
      'package_id', rec.package_id,
      'pkg_status', rec.pkg_status
    );
  END LOOP;

  IF v_cancelled > 0 THEN
    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail, metadata)
    VALUES (
      'non_building_job_reap',
      'fn_reap_non_building_pending_jobs',
      'job_queue',
      'applied',
      format('Cancelled %s pending jobs for non-building packages', v_cancelled),
      jsonb_build_object('cancelled', v_cancelled, 'details', to_jsonb(v_details))
    );
  END IF;

  RETURN jsonb_build_object(
    'cancelled', v_cancelled,
    'details', to_jsonb(v_details)
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- P3: Zombie reaper — add cancel taxonomy to meta
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_reap_zombie_processing_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reaped int := 0;
  v_job record;
BEGIN
  FOR v_job IN
    SELECT id, job_type, package_id, locked_by, locked_at, last_error
    FROM job_queue
    WHERE status = 'processing'
      AND locked_at < now() - interval '10 minutes'
      AND updated_at < now() - interval '10 minutes'
    ORDER BY locked_at ASC
    LIMIT 50
  LOOP
    -- Zombie reaper resets to pending (not cancelled) — this is correct
    UPDATE job_queue
    SET status = 'pending',
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now(),
        last_error = format('ZOMBIE_REAP: was processing since %s by %s, original error: %s',
          v_job.locked_at, coalesce(v_job.locked_by, 'unknown'), coalesce(v_job.last_error, 'none')),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'zombie_reaped_at', now(),
          'zombie_reap_source', 'fn_reap_zombie_processing_jobs',
          'prev_locked_by', v_job.locked_by
        )
    WHERE id = v_job.id
      AND status = 'processing';

    IF FOUND THEN
      v_reaped := v_reaped + 1;

      INSERT INTO auto_heal_log (
        action_type, trigger_source, target_type, target_id,
        result_status, result_detail, metadata
      ) VALUES (
        'reap_zombie_processing',
        'fn_reap_zombie_processing_jobs',
        'job',
        v_job.id,
        'success',
        format('Reaped zombie %s (locked %s ago by %s)',
          v_job.job_type,
          age(now(), v_job.locked_at),
          coalesce(v_job.locked_by, 'unknown')),
        jsonb_build_object(
          'job_type', v_job.job_type,
          'package_id', v_job.package_id,
          'locked_at', v_job.locked_at,
          'locked_by', v_job.locked_by
        )
      );
    END IF;
  END LOOP;

  RETURN v_reaped;
END;
$$;
