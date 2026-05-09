
-- Fix B: Relaxiere fn_guard_governance_step_finalization für legitime, frische
-- processing-Jobs mit Heartbeat ≤ 3min. Kein genereller Bypass — jede Ausnahme
-- wird in auto_heal_log mit job_id+package_id+heartbeat_age als Audit geschrieben.
CREATE OR REPLACE FUNCTION public.fn_guard_governance_step_finalization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_integrity_passed boolean;
  v_job_completed boolean;
  v_processing_job_id uuid;
  v_processing_heartbeat timestamptz;
  v_heartbeat_age_sec numeric;
  v_meta jsonb;
  v_executed boolean;
  v_status text;
  v_verdict text;
  v_badge text;
  v_score numeric;
  v_target_job_type text;
BEGIN
  IF NEW.status <> 'done' THEN RETURN NEW; END IF;
  IF OLD.status = 'done' THEN RETURN NEW; END IF;

  v_meta := COALESCE(NEW.meta, '{}'::jsonb);

  IF NEW.step_key NOT IN ('run_integrity_check','quality_council') THEN
    RETURN NEW;
  END IF;

  v_target_job_type := CASE NEW.step_key
    WHEN 'run_integrity_check' THEN 'package_run_integrity_check'
    WHEN 'quality_council'     THEN 'package_quality_council'
  END;

  -- Suche zuerst nach einem completed Job (Standardfall, unverändert)
  SELECT EXISTS(
    SELECT 1 FROM job_queue
    WHERE job_type = v_target_job_type
      AND package_id = NEW.package_id
      AND status = 'completed'
  ) INTO v_job_completed;

  -- Fix B: wenn kein completed Job existiert, akzeptiere auch einen frischen
  -- processing-Job (Heartbeat ≤ 3min) — der Worker reconciled meta.executed=true
  -- VOR dem Job-Status-Update. Das schützt vor PRE_HEARTBEAT_KILL-Rollbacks.
  IF NOT v_job_completed THEN
    SELECT id, last_heartbeat_at
      INTO v_processing_job_id, v_processing_heartbeat
    FROM job_queue
    WHERE job_type = v_target_job_type
      AND package_id = NEW.package_id
      AND status = 'processing'
      AND last_heartbeat_at IS NOT NULL
      AND last_heartbeat_at > now() - interval '3 minutes'
    ORDER BY last_heartbeat_at DESC
    LIMIT 1;

    IF v_processing_job_id IS NOT NULL THEN
      v_heartbeat_age_sec := EXTRACT(EPOCH FROM (now() - v_processing_heartbeat));
      -- Audit JEDEN Bypass mit Job + Package
      PERFORM fn_log_guardrail_event('governance_processing_heartbeat_bypass', jsonb_build_object(
        'package_id', NEW.package_id,
        'step_key', NEW.step_key,
        'job_id', v_processing_job_id,
        'job_type', v_target_job_type,
        'heartbeat_age_sec', v_heartbeat_age_sec,
        'reason', 'WORKER_RECONCILE_BEFORE_JOB_COMPLETE'
      ));
      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
      VALUES (
        'governance_processing_heartbeat_bypass',
        'package_step',
        NEW.package_id,
        'success',
        format('Step %s finalized while job %s still processing (heartbeat %.1fs old)',
               NEW.step_key, v_target_job_type, v_heartbeat_age_sec),
        jsonb_build_object(
          'package_id', NEW.package_id,
          'step_key', NEW.step_key,
          'job_id', v_processing_job_id,
          'job_type', v_target_job_type,
          'heartbeat_age_sec', v_heartbeat_age_sec,
          'meta', v_meta
        )
      );
      v_job_completed := true; -- Behandle wie completed für die folgenden Checks
    END IF;
  END IF;

  IF NEW.step_key = 'run_integrity_check' THEN
    IF NOT v_job_completed AND (v_meta->>'executed')::boolean IS DISTINCT FROM true THEN
      PERFORM fn_log_guardrail_event('governance_phantom_blocked', jsonb_build_object(
        'package_id', NEW.package_id, 'step_key', NEW.step_key,
        'reason', 'NO_COMPLETED_JOB_AND_NO_EXECUTION_EVIDENCE'));
      RAISE EXCEPTION 'GOVERNANCE GUARD: run_integrity_check cannot be done without completed job or meta.executed=true (package=%)', NEW.package_id;
    END IF;

    SELECT integrity_passed INTO v_integrity_passed FROM course_packages WHERE id = NEW.package_id;
    IF v_integrity_passed IS DISTINCT FROM true THEN
      PERFORM fn_log_guardrail_event('governance_phantom_blocked', jsonb_build_object(
        'package_id', NEW.package_id, 'step_key', NEW.step_key,
        'reason', 'INTEGRITY_NOT_PASSED', 'integrity_passed', v_integrity_passed));
      RAISE EXCEPTION 'GOVERNANCE GUARD: run_integrity_check cannot be done when integrity_passed=% (package=%)', v_integrity_passed, NEW.package_id;
    END IF;
    RETURN NEW;
  END IF;

  -- quality_council
  v_executed := (v_meta->>'executed')::boolean;
  v_status   := v_meta->>'status';
  v_verdict  := v_meta->>'verdict';
  v_badge    := v_meta->>'badge';
  v_score    := NULLIF(v_meta->>'score','')::numeric;

  IF NOT v_job_completed AND v_executed IS DISTINCT FROM true THEN
    PERFORM fn_log_guardrail_event('governance_phantom_blocked', jsonb_build_object(
      'package_id', NEW.package_id, 'step_key', NEW.step_key,
      'reason', 'NO_COMPLETED_JOB_AND_NO_EXECUTION_EVIDENCE',
      'verdict', v_verdict, 'badge', v_badge, 'score', v_score));
    RAISE EXCEPTION 'GOVERNANCE GUARD: quality_council cannot be done without completed job or meta.executed=true (package=%)', NEW.package_id;
  END IF;

  IF v_executed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'GOVERNANCE GUARD: quality_council requires meta.executed=true (package=%)', NEW.package_id;
  END IF;

  IF (v_meta->>'bypass')::boolean = true THEN
    PERFORM fn_log_guardrail_event('governance_council_admin_bypass', jsonb_build_object(
      'package_id', NEW.package_id, 'verdict', v_verdict, 'badge', v_badge, 'score', v_score));
    RETURN NEW;
  END IF;

  IF v_status = 'pass' AND v_score IS NOT NULL AND v_score >= 85 THEN
    RETURN NEW;
  END IF;

  IF v_verdict = 'REVIEW_REQUIRED'
     AND v_badge = 'bronze'
     AND v_score IS NOT NULL
     AND v_score >= 75 AND v_score < 85 THEN
    PERFORM fn_log_guardrail_event('governance_council_bronze_finalized', jsonb_build_object(
      'package_id', NEW.package_id, 'score', v_score, 'verdict', v_verdict));
    RETURN NEW;
  END IF;

  PERFORM fn_log_guardrail_event('governance_phantom_blocked', jsonb_build_object(
    'package_id', NEW.package_id, 'step_key', NEW.step_key,
    'reason', 'STEP_META_DOES_NOT_PROVE_PASS_OR_BRONZE',
    'executed', v_executed, 'status', v_status,
    'verdict', v_verdict, 'badge', v_badge, 'score', v_score));
  RAISE EXCEPTION 'GOVERNANCE GUARD: quality_council finalization requires PASS (status=pass, score>=85) or BRONZE (verdict=REVIEW_REQUIRED, badge=bronze, score 75..84). Got status=%, verdict=%, badge=%, score=% (package=%)',
    v_status, v_verdict, v_badge, v_score, NEW.package_id;
END;
$function$;

INSERT INTO auto_heal_log (action_type, result_status, result_detail, metadata)
VALUES (
  'governance_guard_relaxed_for_processing_heartbeat',
  'success',
  'fn_guard_governance_step_finalization akzeptiert processing-Job mit Heartbeat ≤3min als gleichwertig zu completed (mit Audit pro Bypass)',
  jsonb_build_object(
    'concern','fix_b_governance_relax',
    'rollback_hint','Vorherige Version stand ohne processing-Heartbeat-Pfad in fn_guard_governance_step_finalization (siehe migration history)',
    'migrated_at', now()
  )
);
