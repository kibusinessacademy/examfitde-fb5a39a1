
-- Hard guard: prevent verifier-reconciler from phantom-finalizing governance steps
-- run_integrity_check must only be 'done' if a real job completed AND integrity_passed=true
-- quality_council must only be 'done' if council_approved=true

CREATE OR REPLACE FUNCTION fn_guard_governance_step_finalization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_integrity_passed boolean;
  v_council_approved boolean;
  v_job_exists boolean;
  v_meta jsonb;
BEGIN
  -- Only fire on transition TO 'done'
  IF NEW.status <> 'done' THEN RETURN NEW; END IF;
  IF OLD.status = 'done' THEN RETURN NEW; END IF;

  v_meta := COALESCE(NEW.meta, '{}'::jsonb);

  -- ═══ run_integrity_check ═══
  IF NEW.step_key = 'run_integrity_check' THEN
    -- Must have a completed job as evidence
    SELECT EXISTS(
      SELECT 1 FROM job_queue
      WHERE job_type = 'package_run_integrity_check'
        AND package_id = NEW.package_id
        AND status = 'completed'
    ) INTO v_job_exists;

    IF NOT v_job_exists THEN
      -- Allow if meta.executed = true (edge function ran inline)
      IF (v_meta->>'executed')::boolean IS DISTINCT FROM true THEN
        PERFORM fn_log_guardrail_event(
          'governance_phantom_blocked',
          jsonb_build_object(
            'package_id', NEW.package_id,
            'step_key', NEW.step_key,
            'reason', 'NO_COMPLETED_JOB_AND_NO_EXECUTION_EVIDENCE',
            'finalization_source', v_meta->>'finalization_source'
          )
        );
        RAISE EXCEPTION 'GOVERNANCE GUARD: run_integrity_check cannot be done without completed job or meta.executed=true (package=%)', NEW.package_id;
      END IF;
    END IF;

    -- Must have integrity_passed=true on the package
    SELECT integrity_passed INTO v_integrity_passed
    FROM course_packages WHERE id = NEW.package_id;

    IF v_integrity_passed IS DISTINCT FROM true THEN
      PERFORM fn_log_guardrail_event(
        'governance_phantom_blocked',
        jsonb_build_object(
          'package_id', NEW.package_id,
          'step_key', NEW.step_key,
          'reason', 'INTEGRITY_NOT_PASSED',
          'integrity_passed', v_integrity_passed
        )
      );
      RAISE EXCEPTION 'GOVERNANCE GUARD: run_integrity_check cannot be done when integrity_passed=% (package=%)', v_integrity_passed, NEW.package_id;
    END IF;
  END IF;

  -- ═══ quality_council ═══
  IF NEW.step_key = 'quality_council' THEN
    SELECT EXISTS(
      SELECT 1 FROM job_queue
      WHERE job_type = 'package_quality_council'
        AND package_id = NEW.package_id
        AND status = 'completed'
    ) INTO v_job_exists;

    IF NOT v_job_exists THEN
      IF (v_meta->>'executed')::boolean IS DISTINCT FROM true THEN
        PERFORM fn_log_guardrail_event(
          'governance_phantom_blocked',
          jsonb_build_object(
            'package_id', NEW.package_id,
            'step_key', NEW.step_key,
            'reason', 'NO_COMPLETED_JOB_AND_NO_EXECUTION_EVIDENCE',
            'finalization_source', v_meta->>'finalization_source'
          )
        );
        RAISE EXCEPTION 'GOVERNANCE GUARD: quality_council cannot be done without completed job or meta.executed=true (package=%)', NEW.package_id;
      END IF;
    END IF;

    SELECT council_approved INTO v_council_approved
    FROM course_packages WHERE id = NEW.package_id;

    IF v_council_approved IS DISTINCT FROM true THEN
      PERFORM fn_log_guardrail_event(
        'governance_phantom_blocked',
        jsonb_build_object(
          'package_id', NEW.package_id,
          'step_key', NEW.step_key,
          'reason', 'COUNCIL_NOT_APPROVED',
          'council_approved', v_council_approved
        )
      );
      RAISE EXCEPTION 'GOVERNANCE GUARD: quality_council cannot be done when council_approved=% (package=%)', v_council_approved, NEW.package_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop if exists and recreate
DROP TRIGGER IF EXISTS trg_guard_governance_step_finalization ON package_steps;
CREATE TRIGGER trg_guard_governance_step_finalization
  BEFORE UPDATE ON package_steps
  FOR EACH ROW
  WHEN (NEW.step_key IN ('run_integrity_check', 'quality_council') AND NEW.status = 'done')
  EXECUTE FUNCTION fn_guard_governance_step_finalization();
