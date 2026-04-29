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
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  IF NEW.job_type IS NULL OR NEW.job_type NOT LIKE 'package_%' THEN RETURN NEW; END IF;
  v_step_key := substring(NEW.job_type FROM 9);

  v_skipped := COALESCE((v_result->>'skipped')::boolean, false)
            OR COALESCE((NEW.meta->>'skipped')::boolean, false);

  v_is_governance := v_step_key IN ('run_integrity_check','quality_council','auto_publish');
  v_new_status := (CASE WHEN v_skipped THEN 'skipped' ELSE 'done' END)::step_status;

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

    v_gov_meta := jsonb_build_object(
      'executed', true,
      'ok', v_ok,
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
           meta        = COALESCE(meta, '{}'::jsonb) || v_gov_meta
     WHERE package_id = NEW.package_id
       AND step_key   = v_step_key
       AND status NOT IN ('done'::step_status,'skipped'::step_status);
  ELSE
    -- Non-Governance: derive ok from result hierarchically (fallback true for skipped, otherwise true since job completed)
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