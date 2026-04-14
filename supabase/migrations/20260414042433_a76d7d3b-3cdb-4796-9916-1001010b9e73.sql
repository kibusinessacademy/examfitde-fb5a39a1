
-- 1. Trigger to auto-stamp cancel metadata when missing
CREATE OR REPLACE FUNCTION fn_stamp_cancel_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only fire on transition TO cancelled
  IF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
    -- Auto-stamp cancel_reason if missing
    IF NEW.meta IS NULL THEN
      NEW.meta := '{}'::jsonb;
    END IF;
    
    IF NEW.meta->>'cancel_reason' IS NULL THEN
      NEW.meta := NEW.meta || jsonb_build_object(
        'cancel_reason', COALESCE(
          NULLIF(TRIM(COALESCE(NEW.last_error, '')), ''),
          'unsigned_cancel'
        )
      );
    END IF;
    
    IF NEW.meta->>'transition_source' IS NULL THEN
      NEW.meta := NEW.meta || jsonb_build_object(
        'transition_source', 'auto_stamped_unknown'
      );
    END IF;
    
    IF NEW.meta->>'transition_prev_status' IS NULL THEN
      NEW.meta := NEW.meta || jsonb_build_object(
        'transition_prev_status', OLD.status,
        'transition_at', now()::text
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_cancel_audit ON job_queue;
CREATE TRIGGER trg_stamp_cancel_audit
  BEFORE UPDATE ON job_queue
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION fn_stamp_cancel_audit();

-- 2. Fix fn_cancel_zombie_jobs to sign cancels
CREATE OR REPLACE FUNCTION fn_cancel_zombie_jobs()
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cancelled int;
  v_repair_whitelist text[] := ARRAY[
    'package_repair_exam_pool_quality',
    'package_exam_rebalance',
    'pool_fill_bloom_gaps',
    'pool_fill_lf_gaps',
    'pool_fill_trap_gaps',
    'package_run_integrity_check',
    'package_validate_exam_pool',
    'package_quality_council'
  ];
BEGIN
  WITH zombies AS (
    UPDATE job_queue jq
    SET status = 'cancelled',
        last_error = format('ZOMBIE_GUARD: package status is %s (not building)', cp.status),
        completed_at = now(),
        updated_at = now(),
        locked_at = NULL,
        locked_by = NULL,
        meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
          'cancel_reason', 'zombie_guard_non_building',
          'transition_source', 'fn_cancel_zombie_jobs',
          'transition_prev_status', jq.status,
          'transition_at', now()::text,
          'pkg_status', cp.status
        )
    FROM course_packages cp
    WHERE jq.package_id = cp.id
      AND jq.status = 'pending'
      AND cp.status NOT IN ('building')
      AND jq.job_type != ALL(v_repair_whitelist)
    RETURNING jq.id
  )
  SELECT count(*) INTO v_cancelled FROM zombies;

  IF v_cancelled > 0 THEN
    INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
    VALUES ('zombie_guard_cleanup', NULL, NULL,
            jsonb_build_object('cancelled_count', v_cancelled));
  END IF;

  RETURN v_cancelled;
END;
$$;

-- 3. Fix fn_auto_cancel_jobs_on_package_exit to sign cancels
CREATE OR REPLACE FUNCTION fn_auto_cancel_jobs_on_package_exit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cancelled int := 0;
  v_gate_class text;
BEGIN
  IF OLD.status = 'building' AND NEW.status IS DISTINCT FROM 'building' THEN
    
    IF NEW.status = 'queued' THEN
      RETURN NEW;
    END IF;
    
    v_gate_class := COALESCE(NEW.gate_class, 'unknown');
    
    IF NEW.status = 'quality_gate_failed' AND v_gate_class = 'recoverable' THEN
      NEW.status := 'building';
      NEW.gate_class := 'recoverable';
      INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
      VALUES ('qgf_bounce_prevented', NEW.id, 'run_integrity_check',
              jsonb_build_object(
                'blocked_transition', 'building→quality_gate_failed',
                'gate_class', v_gate_class,
                'reason', 'recoverable failures do not allow package termination'
              ));
      RETURN NEW;
    END IF;

    WITH cancelled AS (
      UPDATE job_queue jq
      SET status = 'cancelled',
          last_error = format('AUTO_CANCEL: package status changed %s → %s (gate_class=%s)', OLD.status, NEW.status, v_gate_class),
          completed_at = now(),
          updated_at = now(),
          locked_at = NULL,
          locked_by = NULL,
          meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
            'cancel_reason', 'package_exit_building',
            'transition_source', 'fn_auto_cancel_jobs_on_package_exit',
            'transition_prev_status', jq.status,
            'transition_at', now()::text,
            'old_pkg_status', OLD.status,
            'new_pkg_status', NEW.status
          )
      FROM job_type_policies jtp
      WHERE jtp.job_type = jq.job_type
        AND jq.package_id = NEW.id
        AND jq.status IN ('pending', 'batch_pending')
        AND NOT COALESCE(jtp.exempt_from_auto_cancel, false)
      RETURNING jq.id
    )
    SELECT count(*) INTO v_cancelled FROM cancelled;

    WITH cancelled_unknown AS (
      UPDATE job_queue jq
      SET status = 'cancelled',
          last_error = format('AUTO_CANCEL: package status changed %s → %s (gate_class=%s)', OLD.status, NEW.status, v_gate_class),
          completed_at = now(),
          updated_at = now(),
          locked_at = NULL,
          locked_by = NULL,
          meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
            'cancel_reason', 'package_exit_building',
            'transition_source', 'fn_auto_cancel_jobs_on_package_exit',
            'transition_prev_status', jq.status,
            'transition_at', now()::text,
            'old_pkg_status', OLD.status,
            'new_pkg_status', NEW.status
          )
      WHERE jq.package_id = NEW.id
        AND jq.status IN ('pending', 'batch_pending')
        AND NOT EXISTS (SELECT 1 FROM job_type_policies p WHERE p.job_type = jq.job_type AND p.exempt_from_auto_cancel)
      RETURNING jq.id
    )
    SELECT v_cancelled + count(*) INTO v_cancelled FROM cancelled_unknown;

    IF v_cancelled > 0 THEN
      INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
      VALUES ('auto_cancel_on_exit', NEW.id, NULL,
              jsonb_build_object(
                'cancelled_count', v_cancelled,
                'old_status', OLD.status,
                'new_status', NEW.status,
                'gate_class', v_gate_class
              ));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
