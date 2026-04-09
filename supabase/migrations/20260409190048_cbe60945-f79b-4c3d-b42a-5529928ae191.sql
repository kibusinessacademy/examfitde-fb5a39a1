
-- ============================================================
-- Dauermaßnahme 1: STALE_LOCK Hard-Kill Guard (DB Trigger)
-- Auto-fails jobs after 5 STALE_LOCK_RECOVERY cycles
-- Alerts after 3 cycles
-- ============================================================

CREATE OR REPLACE FUNCTION fn_guard_stale_lock_loop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recovery_count integer;
BEGIN
  -- Only act on jobs transitioning to pending with STALE_LOCK marker
  IF NEW.status NOT IN ('pending', 'processing') THEN
    RETURN NEW;
  END IF;
  
  IF NEW.last_error IS NULL OR NEW.last_error::text NOT ILIKE '%STALE_LOCK_RECOVERY%' THEN
    RETURN NEW;
  END IF;

  v_recovery_count := COALESCE(NEW.attempts, 0);

  -- Level 3: Hard kill at >= 5 recoveries
  IF v_recovery_count >= 5 THEN
    NEW.status := 'failed';
    NEW.locked_at := NULL;
    NEW.locked_by := NULL;
    NEW.last_error := format(
      'STALE_LOCK_LOOP_HARD_KILL: %s recovery cycles without completion. Auto-terminated by guard trigger.',
      v_recovery_count
    );
    NEW.updated_at := now();

    -- Flag package for review
    UPDATE course_packages
    SET stuck_reason = format(
      'Stale-lock loop: job %s (%s) killed after %s recoveries — review required',
      NEW.id, NEW.job_type, v_recovery_count
    )
    WHERE id = NEW.package_id
      AND (stuck_reason IS NULL OR stuck_reason = '');

    -- Admin notification (critical)
    INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
    VALUES (
      format('🔒 STALE_LOCK HARD KILL: %s', NEW.job_type),
      format('Job %s wurde nach %s STALE_LOCK_RECOVERY Zyklen terminiert. Package: %s. Manuelle Prüfung erforderlich.',
        left(NEW.id::text, 8), v_recovery_count, left(COALESCE(NEW.package_id::text, 'n/a'), 8)),
      'ops',
      'critical',
      'job_queue',
      NEW.id::text,
      jsonb_build_object(
        'kind', 'stale_lock_hard_kill',
        'job_type', NEW.job_type,
        'attempts', v_recovery_count,
        'package_id', NEW.package_id
      )
    );

    -- Audit log
    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'stale_lock_hard_kill',
      'trg_guard_stale_lock_loop',
      'job_queue',
      NEW.id::text,
      'applied',
      format('Hard-killed after %s STALE_LOCK_RECOVERY cycles', v_recovery_count),
      jsonb_build_object('job_type', NEW.job_type, 'package_id', NEW.package_id, 'attempts', v_recovery_count)
    );

    RETURN NEW;
  END IF;

  -- Level 2: Alert at >= 3 recoveries
  IF v_recovery_count >= 3 THEN
    -- Check dedup: no alert in last 2 hours for this job
    IF NOT EXISTS (
      SELECT 1 FROM admin_notifications
      WHERE entity_id = NEW.id::text
        AND metadata->>'kind' = 'stale_lock_warning'
        AND created_at > now() - interval '2 hours'
    ) THEN
      INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
      VALUES (
        format('⚠️ Stale-Lock Warning: %s', NEW.job_type),
        format('Job %s hat %s STALE_LOCK_RECOVERY Zyklen. Wird bei 5 automatisch terminiert. Package: %s.',
          left(NEW.id::text, 8), v_recovery_count, left(COALESCE(NEW.package_id::text, 'n/a'), 8)),
        'ops',
        'warning',
        'job_queue',
        NEW.id::text,
        jsonb_build_object(
          'kind', 'stale_lock_warning',
          'job_type', NEW.job_type,
          'attempts', v_recovery_count,
          'package_id', NEW.package_id
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger (drop first if exists)
DROP TRIGGER IF EXISTS trg_guard_stale_lock_loop ON job_queue;
CREATE TRIGGER trg_guard_stale_lock_loop
  BEFORE UPDATE ON job_queue
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_stale_lock_loop();


-- ============================================================
-- Dauermaßnahme 2: Ghost-Finalization-Guard
-- Detects steps with no start but high-attempt jobs
-- ============================================================

CREATE OR REPLACE FUNCTION fn_guard_ghost_finalization()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed integer := 0;
  v_jobs_cancelled integer := 0;
  rec record;
BEGIN
  -- Find steps in running/queued where ALL associated jobs have high attempts
  -- but the step itself was never started
  FOR rec IN
    SELECT 
      ps.package_id,
      ps.step_key,
      ps.status as step_status,
      ps.started_at as step_started_at,
      max(j.attempts) as max_job_attempts,
      count(j.id) as job_count,
      array_agg(j.id) as job_ids
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    JOIN job_queue j ON j.package_id = ps.package_id
    WHERE cp.status = 'building'
      AND ps.status IN ('running', 'enqueued')
      AND ps.started_at IS NULL
      AND j.status IN ('pending', 'processing', 'failed')
      AND j.attempts >= 3
    GROUP BY ps.package_id, ps.step_key, ps.status, ps.started_at
    HAVING max(j.attempts) >= 3
  LOOP
    -- Reset step to queued
    UPDATE package_steps
    SET 
      status = 'queued',
      started_at = NULL,
      finished_at = NULL,
      last_error = NULL,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'ghost_guard_healed_at', now()::text,
        'ghost_max_job_attempts', rec.max_job_attempts,
        'ghost_job_count', rec.job_count
      )
    WHERE package_id = rec.package_id
      AND step_key = rec.step_key;
    
    v_healed := v_healed + 1;

    -- Cancel the ghost jobs
    UPDATE job_queue
    SET 
      status = 'failed',
      last_error = format('GHOST_FINALIZATION_BLOCKED: Step %s never started despite %s job attempts. Auto-cancelled.', 
        rec.step_key, rec.max_job_attempts),
      updated_at = now()
    WHERE id = ANY(rec.job_ids)
      AND status IN ('pending', 'processing');
    
    GET DIAGNOSTICS v_jobs_cancelled = ROW_COUNT;

    -- Audit
    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'ghost_finalization_guard',
      'fn_guard_ghost_finalization',
      'package_steps',
      rec.package_id::text,
      'applied',
      format('Step %s reset, %s ghost jobs cancelled (max attempts: %s)', 
        rec.step_key, v_jobs_cancelled, rec.max_job_attempts),
      jsonb_build_object(
        'step_key', rec.step_key,
        'max_job_attempts', rec.max_job_attempts,
        'job_count', rec.job_count,
        'jobs_cancelled', v_jobs_cancelled
      )
    );

    -- Notify admin
    INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
    VALUES (
      format('👻 Ghost-Finalization: %s', rec.step_key),
      format('Step %s (Package %s) hatte %s Jobs mit bis zu %s Attempts aber wurde nie gestartet. Reset auf queued.',
        rec.step_key, left(rec.package_id::text, 8), rec.job_count, rec.max_job_attempts),
      'ops',
      'warning',
      'package',
      rec.package_id::text,
      jsonb_build_object(
        'kind', 'ghost_finalization_guard',
        'step_key', rec.step_key,
        'max_job_attempts', rec.max_job_attempts
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'steps_healed', v_healed,
    'ran_at', now()::text
  );
END;
$$;

-- Schedule ghost-finalization guard every 15 minutes
SELECT cron.schedule(
  'ghost-finalization-guard',
  '*/15 * * * *',
  $$SELECT fn_guard_ghost_finalization()$$
);
