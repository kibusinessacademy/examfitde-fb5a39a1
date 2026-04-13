
-- Fix 1: fn_auto_cancel_jobs_on_package_exit should NOT cancel on building→queued
-- queued is not terminal — it's a temporary demotion that gets reversed immediately
CREATE OR REPLACE FUNCTION public.fn_auto_cancel_jobs_on_package_exit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled int := 0;
  v_gate_class text;
  v_terminal_statuses text[] := ARRAY['quality_gate_failed','blocked','intentional_pause','failed','draft'];
BEGIN
  -- Only act when leaving 'building'
  IF OLD.status = 'building' AND NEW.status IS DISTINCT FROM 'building' THEN
    
    -- queued is NOT a terminal exit — it's a temporary demotion
    -- Do NOT cancel jobs on building → queued transitions
    IF NEW.status = 'queued' THEN
      RETURN NEW;
    END IF;
    
    -- Check gate_class: if 'recoverable', do NOT cancel jobs
    v_gate_class := COALESCE(NEW.gate_class, 'unknown');
    
    IF NEW.status = 'quality_gate_failed' AND v_gate_class = 'recoverable' THEN
      -- BLOCK the transition: recoverable failures must stay in building
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

    -- Terminal exit or other status change: cancel non-exempt jobs
    WITH cancelled AS (
      UPDATE job_queue jq
      SET status = 'cancelled',
          last_error = format('AUTO_CANCEL: package status changed %s → %s (gate_class=%s)', OLD.status, NEW.status, v_gate_class),
          completed_at = now(),
          updated_at = now(),
          locked_at = NULL,
          locked_by = NULL
      FROM job_type_policies jtp
      WHERE jtp.job_type = jq.job_type
        AND jq.package_id = NEW.id
        AND jq.status IN ('pending', 'batch_pending')
        AND NOT COALESCE(jtp.exempt_from_auto_cancel, false)
      RETURNING jq.id
    )
    SELECT count(*) INTO v_cancelled FROM cancelled;

    -- Also cancel unknown job types
    WITH cancelled_unknown AS (
      UPDATE job_queue jq
      SET status = 'cancelled',
          last_error = format('AUTO_CANCEL: package status changed %s → %s (gate_class=%s)', OLD.status, NEW.status, v_gate_class),
          completed_at = now(),
          updated_at = now(),
          locked_at = NULL,
          locked_by = NULL
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

-- Fix 2: Prevent building→queued when package has active jobs
CREATE OR REPLACE FUNCTION public.fn_guard_building_to_queued_with_jobs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_jobs int;
BEGIN
  -- Only guard building → queued transitions
  IF OLD.status = 'building' AND NEW.status = 'queued' THEN
    SELECT count(*) INTO v_active_jobs
    FROM job_queue
    WHERE package_id = NEW.id
      AND status IN ('pending', 'processing', 'batch_pending');
    
    -- If there are active jobs, block the demotion
    IF v_active_jobs > 0 THEN
      NEW.status := 'building';  -- Keep building
      PERFORM public.fn_log_guardrail_event(
        'building_to_queued_blocked',
        jsonb_build_object(
          'package_id', NEW.id,
          'active_jobs', v_active_jobs,
          'reason', 'Cannot demote to queued while active jobs exist'
        )
      );
      RETURN NEW;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger (BEFORE UPDATE, high priority to fire before auto_cancel)
DROP TRIGGER IF EXISTS trg_guard_building_to_queued_with_jobs ON course_packages;
CREATE TRIGGER trg_guard_building_to_queued_with_jobs
  BEFORE UPDATE ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_building_to_queued_with_jobs();
