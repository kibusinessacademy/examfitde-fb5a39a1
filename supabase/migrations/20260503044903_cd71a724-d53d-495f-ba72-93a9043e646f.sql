-- Fix Worker-Stillstand v3: Governance-Step Reconciler respektiert Gate-Verdict
-- Root: fn_trg_job_complete_reconcile_step setzte governance steps unconditional auf 'done'
-- mit meta {executed,ok} ohne status/score → fn_guard_governance_step_finalization
-- blockierte legitim → DB-UPDATE rollback → Job bleibt processing → Reaper → Cancel-Loop.
--
-- Fix:
--   1) Bei governance + v_ok=false: status='failed' (nicht 'done'), Guard fired nicht.
--   2) Bei governance + v_ok=true:  status/score aus result nach meta propagieren,
--      damit Guard die Pass-Evidenz sieht (status='pass', score>=85).
--   3) job_queue selbst bleibt 'completed' (Job lief, Verdict liegt vor) — kein Loop.

CREATE OR REPLACE FUNCTION public.fn_trg_job_complete_reconcile_step()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_step_key text;
  v_skipped  boolean := false;
  v_is_governance boolean := false;
  v_ok boolean := false;
  v_result jsonb := COALESCE(NEW.result, '{}'::jsonb);
  v_pkg_integrity boolean;
  v_gov_meta jsonb;
  v_nongov_meta jsonb;
  v_nongov_ok boolean;
  v_new_status step_status;
  v_gate_status text;
  v_gate_score numeric;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  IF NEW.job_type IS NULL OR NEW.job_type NOT LIKE 'package_%' THEN RETURN NEW; END IF;
  v_step_key := substring(NEW.job_type FROM 9);

  v_skipped := COALESCE((v_result->>'skipped')::boolean, false)
            OR COALESCE((NEW.meta->>'skipped')::boolean, false);

  v_is_governance := v_step_key IN ('run_integrity_check','quality_council','auto_publish');

  IF v_is_governance THEN
    IF v_skipped THEN
      v_ok := true;
    ELSIF v_step_key = 'run_integrity_check' THEN
      IF (v_result ? 'gate_passed') THEN
        v_ok := COALESCE((v_result->>'gate_passed')::boolean, false);
      ELSIF (v_result ? 'integrity_passed') THEN
        v_ok := COALESCE((v_result->>'integrity_passed')::boolean, false);
      ELSIF (v_result ? 'ok') THEN
        v_ok := COALESCE((v_result->>'ok')::boolean, false);
      ELSE
        SELECT integrity_passed INTO v_pkg_integrity FROM course_packages WHERE id = NEW.package_id;
        v_ok := COALESCE(v_pkg_integrity, false);
      END IF;
    ELSIF v_step_key = 'quality_council' THEN
      IF (v_result ? 'council_passed') THEN
        v_ok := COALESCE((v_result->>'council_passed')::boolean, false);
      ELSIF (v_result ? 'passed') THEN
        v_ok := COALESCE((v_result->>'passed')::boolean, false);
      ELSIF (v_result ? 'status') THEN
        v_ok := (v_result->>'status') = 'pass';
      ELSIF (v_result ? 'ok') THEN
        v_ok := COALESCE((v_result->>'ok')::boolean, false);
      ELSE
        v_ok := true;
      END IF;
    ELSIF v_step_key = 'auto_publish' THEN
      IF (v_result ? 'published') THEN
        v_ok := COALESCE((v_result->>'published')::boolean, false);
      ELSIF (v_result ? 'ok') THEN
        v_ok := COALESCE((v_result->>'ok')::boolean, false);
      ELSE
        v_ok := true;
      END IF;
    END IF;

    -- ── KEY FIX 1: status='failed' wenn Gate-Verdict negativ ──
    -- Guard fn_guard_governance_step_finalization fired nur bei status='done'.
    -- 'failed' ist legitime Terminal-Wertung → kein Loop.
    v_new_status := (CASE
                       WHEN v_skipped THEN 'skipped'
                       WHEN v_ok      THEN 'done'
                       ELSE                'failed'
                     END)::step_status;

    -- ── KEY FIX 2: status/score aus result propagieren ──
    -- Guard verlangt für quality_council step.meta.status='pass' + score>=85.
    -- Ohne diese Felder schlug auch der Pass-Pfad fehl wenn step.meta von edge-fn
    -- noch nicht gesetzt war (Race / leerer Erstlauf).
    v_gate_status := COALESCE(v_result->>'status', CASE WHEN v_ok THEN 'pass' ELSE 'fail' END);
    v_gate_score  := NULLIF(v_result->>'score','')::numeric;

    v_gov_meta := jsonb_build_object(
      'executed', true,
      'ok', v_ok,
      'status', v_gate_status,
      'reconciled_from_job', NEW.id,
      'reconciled_at', now(),
      'source_fn', 'fn_trg_job_complete_reconcile_step'
    );
    IF v_gate_score IS NOT NULL THEN
      v_gov_meta := v_gov_meta || jsonb_build_object('score', v_gate_score);
    END IF;

    UPDATE package_steps
       SET status      = v_new_status,
           started_at  = COALESCE(started_at, NEW.started_at, NEW.created_at, now()),
           attempts    = GREATEST(COALESCE(attempts, 0), COALESCE(NEW.attempts, 1), 1),
           finished_at = COALESCE(finished_at, NEW.completed_at, now()),
           updated_at  = now(),
           last_error  = CASE WHEN v_ok OR v_skipped THEN NULL
                              ELSE format('GATE_FAIL: status=%s score=%s', v_gate_status, COALESCE(v_gate_score::text,'n/a')) END,
           meta        = COALESCE(meta, '{}'::jsonb) || v_gov_meta
     WHERE package_id = NEW.package_id
       AND step_key   = v_step_key
       AND status NOT IN ('done'::step_status,'skipped'::step_status);
  ELSE
    -- Non-Governance unverändert
    IF v_skipped THEN
      v_nongov_ok := true;
    ELSE
      v_nongov_ok := COALESCE(
        (v_result->>'ok')::boolean,
        (v_result->>'success')::boolean,
        (v_result->>'passed')::boolean,
        true
      );
    END IF;

    v_new_status := (CASE WHEN v_skipped THEN 'skipped' ELSE 'done' END)::step_status;

    v_nongov_meta := jsonb_build_object(
      'executed', true,
      'ok', v_nongov_ok,
      'reconciled_from_job', NEW.id,
      'reconciled_at', now(),
      'source_fn', 'fn_trg_job_complete_reconcile_step'
    );

    UPDATE package_steps
       SET status      = v_new_status,
           started_at  = COALESCE(started_at, NEW.started_at, NEW.created_at, now()),
           attempts    = GREATEST(COALESCE(attempts, 0), COALESCE(NEW.attempts, 1), 1),
           finished_at = COALESCE(finished_at, NEW.completed_at, now()),
           updated_at  = now(),
           meta        = COALESCE(meta, '{}'::jsonb) || v_nongov_meta
     WHERE package_id = NEW.package_id
       AND step_key   = v_step_key
       AND status NOT IN ('done'::step_status,'skipped'::step_status);
  END IF;

  RETURN NEW;
END;
$function$;

-- One-shot heal: aktuell stuck processing-Jobs der drei Loop-Pakete entlassen,
-- damit Worker frischen Backlog claimt.
UPDATE job_queue
   SET status = 'failed',
       completed_at = now(),
       last_error = 'WORKER_STILLSTAND_V3_HEAL: reconciler-guard-deadlock cleared',
       meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('worker_stillstand_v3_heal', now())
 WHERE status = 'processing'
   AND job_type IN ('package_quality_council','package_run_integrity_check','package_auto_publish')
   AND locked_at < now() - interval '30 seconds';

INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
VALUES (
  'worker_stillstand_v3_root_fix',
  'migration',
  'system',
  NULL,
  'success',
  'fn_trg_job_complete_reconcile_step: governance verdict honored (ok=false → failed, status/score propagated to step.meta)',
  jsonb_build_object('migration_at', now())
);