CREATE OR REPLACE FUNCTION public.fn_trg_job_complete_reconcile_step()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_key text;
  v_skipped  boolean := false;
  v_is_governance boolean := false;
  v_ok boolean := false;
  v_result jsonb := COALESCE(NEW.result, '{}'::jsonb);
  v_pkg_integrity boolean;
  v_gov_meta jsonb;
BEGIN
  -- Only act on transitions into 'completed'
  IF NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  -- Map job_type → step_key (strip leading 'package_')
  IF NEW.job_type IS NULL OR NEW.job_type NOT LIKE 'package_%' THEN
    RETURN NEW;
  END IF;
  v_step_key := substring(NEW.job_type FROM 9); -- after 'package_'

  v_skipped := COALESCE((v_result->>'skipped')::boolean, false)
            OR COALESCE((NEW.meta->>'skipped')::boolean, false);

  v_is_governance := v_step_key IN ('run_integrity_check','quality_council','auto_publish');

  IF v_is_governance THEN
    IF v_skipped THEN
      v_ok := true;
    ELSIF v_step_key = 'run_integrity_check' THEN
      -- Derive ok from job result, fallback to course_packages.integrity_passed
      IF (v_result ? 'gate_passed') THEN
        v_ok := COALESCE((v_result->>'gate_passed')::boolean, false);
      ELSIF (v_result ? 'integrity_passed') THEN
        v_ok := COALESCE((v_result->>'integrity_passed')::boolean, false);
      ELSIF (v_result ? 'ok') THEN
        v_ok := COALESCE((v_result->>'ok')::boolean, false);
      ELSE
        SELECT integrity_passed INTO v_pkg_integrity
        FROM course_packages WHERE id = NEW.package_id;
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
        v_ok := true; -- worker reached completed without veto
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
       SET status = CASE WHEN v_skipped THEN 'skipped' ELSE 'done' END,
           finished_at = COALESCE(finished_at, now()),
           meta = COALESCE(meta, '{}'::jsonb) || v_gov_meta
     WHERE package_id = NEW.package_id
       AND step_key = v_step_key
       AND status NOT IN ('done','skipped');
  ELSE
    -- Non-governance: simple reconcile (no governance meta required)
    UPDATE package_steps
       SET status = CASE WHEN v_skipped THEN 'skipped' ELSE 'done' END,
           finished_at = COALESCE(finished_at, now())
     WHERE package_id = NEW.package_id
       AND step_key = v_step_key
       AND status NOT IN ('done','skipped');
  END IF;

  RETURN NEW;
END;
$$;