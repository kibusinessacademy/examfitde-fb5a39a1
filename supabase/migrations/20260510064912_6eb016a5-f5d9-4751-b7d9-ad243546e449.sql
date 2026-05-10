-- Forensic Job Runner Fix: claimability + governance completion guard

-- 1) Make targeted MiniCheck repair claimable by the active default runner pool.
INSERT INTO public.job_type_policies (
  job_type,
  is_repair,
  can_run_when_not_building,
  exempt_from_auto_cancel,
  notes,
  worker_pool,
  zombie_timeout_minutes
)
VALUES (
  'package_repair_lesson_minichecks',
  true,
  true,
  true,
  'Soft-drift targeted MiniCheck repair may run on already published packages; no package status demote required.',
  'default',
  90
)
ON CONFLICT (job_type) DO UPDATE
SET is_repair = EXCLUDED.is_repair,
    can_run_when_not_building = EXCLUDED.can_run_when_not_building,
    exempt_from_auto_cancel = EXCLUDED.exempt_from_auto_cancel,
    notes = EXCLUDED.notes,
    worker_pool = EXCLUDED.worker_pool,
    zombie_timeout_minutes = EXCLUDED.zombie_timeout_minutes,
    updated_at = now();

UPDATE public.ops_job_type_registry
SET pool = 'default',
    lane = 'recovery',
    description = 'Soft-Drift targeted MiniCheck repair: archives unapproved MCs and regenerates targeted replacements. Claimable by default runner and allowed on published packages.',
    is_active = true,
    requires_package_id = true,
    is_governance = false,
    updated_at = now()
WHERE job_type = 'package_repair_lesson_minichecks';

INSERT INTO public.ops_job_type_registry (
  job_type,
  pool,
  lane,
  description,
  requires_package_id,
  is_governance,
  is_active
)
SELECT
  'package_repair_lesson_minichecks',
  'default',
  'recovery',
  'Soft-Drift targeted MiniCheck repair: archives unapproved MCs and regenerates targeted replacements. Claimable by default runner and allowed on published packages.',
  true,
  false,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.ops_job_type_registry WHERE job_type = 'package_repair_lesson_minichecks'
);

-- 2) Harden governance finalization guard against structured verdict JSON drift.
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
  v_verdict_status text;
  v_badge text;
  v_score numeric;
  v_rules_failed int;
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

  SELECT EXISTS(
    SELECT 1 FROM public.job_queue
    WHERE job_type = v_target_job_type
      AND package_id = NEW.package_id
      AND status = 'completed'
  ) INTO v_job_completed;

  IF NOT v_job_completed THEN
    SELECT id, last_heartbeat_at
      INTO v_processing_job_id, v_processing_heartbeat
    FROM public.job_queue
    WHERE job_type = v_target_job_type
      AND package_id = NEW.package_id
      AND status = 'processing'
      AND last_heartbeat_at IS NOT NULL
      AND last_heartbeat_at > now() - interval '3 minutes'
    ORDER BY last_heartbeat_at DESC
    LIMIT 1;

    IF v_processing_job_id IS NOT NULL THEN
      v_heartbeat_age_sec := EXTRACT(EPOCH FROM (now() - v_processing_heartbeat));
      PERFORM public.fn_log_guardrail_event('governance_processing_heartbeat_bypass', jsonb_build_object(
        'package_id', NEW.package_id,
        'step_key', NEW.step_key,
        'job_id', v_processing_job_id,
        'job_type', v_target_job_type,
        'heartbeat_age_sec', v_heartbeat_age_sec,
        'reason', 'WORKER_RECONCILE_BEFORE_JOB_COMPLETE'
      ));
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
      VALUES (
        'governance_processing_heartbeat_bypass',
        'package_step',
        NEW.package_id,
        'success',
        format('Step %s finalized while job %s still processing (heartbeat %.1fs old)', NEW.step_key, v_target_job_type, v_heartbeat_age_sec),
        jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'job_id', v_processing_job_id, 'job_type', v_target_job_type, 'heartbeat_age_sec', v_heartbeat_age_sec, 'meta', v_meta)
      );
      v_job_completed := true;
    END IF;
  END IF;

  IF NEW.step_key = 'run_integrity_check' THEN
    IF NOT v_job_completed AND (v_meta->>'executed')::boolean IS DISTINCT FROM true THEN
      PERFORM public.fn_log_guardrail_event('governance_phantom_blocked', jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'reason', 'NO_COMPLETED_JOB_AND_NO_EXECUTION_EVIDENCE'));
      RAISE EXCEPTION 'GOVERNANCE GUARD: run_integrity_check cannot be done without completed job or meta.executed=true (package=%)', NEW.package_id;
    END IF;

    SELECT integrity_passed INTO v_integrity_passed FROM public.course_packages WHERE id = NEW.package_id;
    IF v_integrity_passed IS DISTINCT FROM true THEN
      PERFORM public.fn_log_guardrail_event('governance_phantom_blocked', jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'reason', 'INTEGRITY_NOT_PASSED', 'integrity_passed', v_integrity_passed));
      RAISE EXCEPTION 'GOVERNANCE GUARD: run_integrity_check cannot be done when integrity_passed=% (package=%)', v_integrity_passed, NEW.package_id;
    END IF;
    RETURN NEW;
  END IF;

  v_executed := (v_meta->>'executed')::boolean;
  v_status   := v_meta->>'status';
  v_verdict  := v_meta->>'verdict';
  v_verdict_status := COALESCE(v_meta->'verdict'->>'status', v_verdict);
  v_badge    := COALESCE(v_meta->>'badge', v_meta->'verdict'->>'badge');
  v_score    := NULLIF(v_meta->>'score','')::numeric;
  v_rules_failed := COALESCE(NULLIF(v_meta->>'rules_failed','')::int, 0);

  IF NOT v_job_completed AND v_executed IS DISTINCT FROM true THEN
    PERFORM public.fn_log_guardrail_event('governance_phantom_blocked', jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'reason', 'NO_COMPLETED_JOB_AND_NO_EXECUTION_EVIDENCE', 'verdict', v_verdict_status, 'badge', v_badge, 'score', v_score));
    RAISE EXCEPTION 'GOVERNANCE GUARD: quality_council cannot be done without completed job or meta.executed=true (package=%)', NEW.package_id;
  END IF;

  IF v_executed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'GOVERNANCE GUARD: quality_council requires meta.executed=true (package=%)', NEW.package_id;
  END IF;

  IF (v_meta->>'bypass')::boolean = true THEN
    PERFORM public.fn_log_guardrail_event('governance_council_admin_bypass', jsonb_build_object('package_id', NEW.package_id, 'verdict', v_verdict_status, 'badge', v_badge, 'score', v_score));
    RETURN NEW;
  END IF;

  IF v_status = 'pass' AND v_score IS NOT NULL AND v_score >= 85 THEN
    RETURN NEW;
  END IF;

  IF v_badge = 'bronze'
     AND v_score IS NOT NULL
     AND v_score >= 75
     AND (v_verdict_status = 'REVIEW_REQUIRED' OR v_status = 'REVIEW_REQUIRED' OR v_rules_failed > 0) THEN
    PERFORM public.fn_log_guardrail_event('governance_council_bronze_finalized', jsonb_build_object('package_id', NEW.package_id, 'score', v_score, 'verdict_status', v_verdict_status, 'status', v_status, 'rules_failed', v_rules_failed));
    RETURN NEW;
  END IF;

  PERFORM public.fn_log_guardrail_event('governance_phantom_blocked', jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'reason', 'STEP_META_DOES_NOT_PROVE_PASS_OR_BRONZE', 'executed', v_executed, 'status', v_status, 'verdict', v_verdict_status, 'badge', v_badge, 'score', v_score, 'rules_failed', v_rules_failed));
  RAISE EXCEPTION 'GOVERNANCE GUARD: quality_council finalization requires PASS or BRONZE review. Got status=%, verdict=%, badge=%, score=%, rules_failed=% (package=%)',
    v_status, v_verdict_status, v_badge, v_score, v_rules_failed, NEW.package_id;
END;
$function$;

-- 3) Repair current soft-drift jobs that were failed only by non-building guard before the policy existed.
UPDATE public.job_queue
SET status = 'pending',
    run_after = now(),
    locked_at = NULL,
    locked_by = NULL,
    started_at = NULL,
    completed_at = NULL,
    last_error = NULL,
    error = NULL,
    worker_pool = 'default',
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'requeued_by', 'forensic_job_runner_fix',
      'requeued_at', now(),
      'previous_failure', 'OPS_GUARD_NON_BUILDING_PACKAGE'
    ),
    updated_at = now()
WHERE job_type = 'package_repair_lesson_minichecks'
  AND status = 'failed'
  AND COALESCE(last_error, error, '') ILIKE '%NON_BUILDING_PACKAGE%'
  AND meta->>'wave' = 'soft_drift_mc';

INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
VALUES (
  'job_runner_forensic_fix_applied',
  'migration',
  'system',
  'job_runner',
  'success',
  'Fixed MiniCheck repair claim policy and governance completion guard verdict parsing.',
  jsonb_build_object(
    'rollback_hint', 'Restore previous fn_guard_governance_step_finalization definition and set package_repair_lesson_minichecks policy/registry back to prior pool if needed.',
    'smoke_sql', ARRAY[
      'select * from job_type_policies where job_type=''package_repair_lesson_minichecks''',
      'select job_type,status,count(*) from job_queue where job_type=''package_repair_lesson_minichecks'' and meta->>''wave''=''soft_drift_mc'' group by 1,2'
    ]
  )
);