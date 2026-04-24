-- Fix Henne-Ei in fn_guard_governance_step_finalization for quality_council
-- council_approved=true is a CONSEQUENCE of a successful council run, not a precondition.
-- Allow quality_council->done when the step's own meta proves the council executed and passed:
--   meta.executed=true AND meta.status='pass' AND meta.score>=85
-- Phantom protection is preserved: without that proof on the step, finalization is rejected.

CREATE OR REPLACE FUNCTION public.fn_guard_governance_step_finalization()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_integrity_passed boolean;
  v_council_approved boolean;
  v_job_exists boolean;
  v_meta jsonb;
  v_executed boolean;
  v_status text;
  v_score numeric;
BEGIN
  -- Only fire on transition TO 'done'
  IF NEW.status <> 'done' THEN RETURN NEW; END IF;
  IF OLD.status = 'done' THEN RETURN NEW; END IF;

  v_meta := COALESCE(NEW.meta, '{}'::jsonb);

  -- ═══ run_integrity_check ═══
  IF NEW.step_key = 'run_integrity_check' THEN
    SELECT EXISTS(
      SELECT 1 FROM job_queue
      WHERE job_type = 'package_run_integrity_check'
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
        RAISE EXCEPTION 'GOVERNANCE GUARD: run_integrity_check cannot be done without completed job or meta.executed=true (package=%)', NEW.package_id;
      END IF;
    END IF;

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
  -- Henne-Ei-Fix: Council-Run beweist sich durch Step-Meta selbst.
  -- council_approved auf course_packages ist FOLGE, nicht Vorbedingung.
  IF NEW.step_key = 'quality_council' THEN
    SELECT EXISTS(
      SELECT 1 FROM job_queue
      WHERE job_type = 'package_quality_council'
        AND package_id = NEW.package_id
        AND status = 'completed'
    ) INTO v_job_exists;

    v_executed := (v_meta->>'executed')::boolean;
    v_status   := v_meta->>'status';
    v_score    := NULLIF(v_meta->>'score','')::numeric;

    -- Phantom-Schutz: Entweder Job completed ODER vollständige Pass-Evidenz auf Step-Meta
    IF NOT v_job_exists THEN
      IF v_executed IS DISTINCT FROM true
         OR v_status IS DISTINCT FROM 'pass'
         OR v_score IS NULL OR v_score < 85 THEN
        PERFORM fn_log_guardrail_event(
          'governance_phantom_blocked',
          jsonb_build_object(
            'package_id', NEW.package_id,
            'step_key', NEW.step_key,
            'reason', 'NO_COMPLETED_JOB_AND_INSUFFICIENT_PASS_EVIDENCE',
            'executed', v_executed,
            'status', v_status,
            'score', v_score,
            'finalization_source', v_meta->>'finalization_source'
          )
        );
        RAISE EXCEPTION 'GOVERNANCE GUARD: quality_council cannot be done without completed job or step-meta proof (executed=true, status=pass, score>=85) (package=%)', NEW.package_id;
      END IF;
    END IF;

    -- HÄRTUNG: Auch bei completed Job verlangen wir saubere Pass-Meta auf Step,
    -- um Ghost-Finalization aus externen Quellen zu verhindern.
    IF v_executed IS DISTINCT FROM true
       OR v_status IS DISTINCT FROM 'pass'
       OR v_score IS NULL OR v_score < 85 THEN
      PERFORM fn_log_guardrail_event(
        'governance_phantom_blocked',
        jsonb_build_object(
          'package_id', NEW.package_id,
          'step_key', NEW.step_key,
          'reason', 'STEP_META_DOES_NOT_PROVE_PASS',
          'executed', v_executed,
          'status', v_status,
          'score', v_score
        )
      );
      RAISE EXCEPTION 'GOVERNANCE GUARD: quality_council finalization requires step meta executed=true, status=pass, score>=85 (got executed=%, status=%, score=%) (package=%)', v_executed, v_status, v_score, NEW.package_id;
    END IF;

    -- council_approved Konsistenz wird vom dedizierten trg_guard_council_consistency
    -- geprüft (nach Setzen durch die Edge-Function). Hier KEIN harter Block mehr.
  END IF;

  RETURN NEW;
END;
$function$;