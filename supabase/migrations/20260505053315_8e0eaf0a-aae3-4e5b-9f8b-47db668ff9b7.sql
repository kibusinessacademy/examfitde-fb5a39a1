
CREATE OR REPLACE FUNCTION public.fn_trg_job_complete_reconcile_step()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  v_badge text;
  v_rules_failed int;
  v_is_bronze boolean := false;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;
  IF NEW.job_type IS NULL OR NEW.job_type NOT LIKE 'package_%' THEN RETURN NEW; END IF;
  v_step_key := substring(NEW.job_type FROM 9);
  v_skipped := COALESCE((v_result->>'skipped')::boolean, false)
            OR COALESCE((NEW.meta->>'skipped')::boolean, false);
  v_is_governance := v_step_key IN ('run_integrity_check','quality_council','auto_publish');

  IF v_is_governance THEN
    IF v_skipped THEN v_ok := true;
    ELSIF v_step_key = 'run_integrity_check' THEN
      IF (v_result ? 'gate_passed') THEN v_ok := COALESCE((v_result->>'gate_passed')::boolean, false);
      ELSIF (v_result ? 'integrity_passed') THEN v_ok := COALESCE((v_result->>'integrity_passed')::boolean, false);
      ELSIF (v_result ? 'ok') THEN v_ok := COALESCE((v_result->>'ok')::boolean, false);
      ELSE
        SELECT integrity_passed INTO v_pkg_integrity FROM course_packages WHERE id = NEW.package_id;
        v_ok := COALESCE(v_pkg_integrity, false);
      END IF;
    ELSIF v_step_key = 'quality_council' THEN
      IF (v_result ? 'council_passed') THEN v_ok := COALESCE((v_result->>'council_passed')::boolean, false);
      ELSIF (v_result ? 'passed') THEN v_ok := COALESCE((v_result->>'passed')::boolean, false);
      ELSIF (v_result ? 'status') THEN v_ok := (v_result->>'status') = 'pass';
      ELSIF (v_result ? 'ok') THEN v_ok := COALESCE((v_result->>'ok')::boolean, false);
      ELSE v_ok := true;
      END IF;
    ELSIF v_step_key = 'auto_publish' THEN
      IF (v_result ? 'published') THEN v_ok := COALESCE((v_result->>'published')::boolean, false);
      ELSIF (v_result ? 'ok') THEN v_ok := COALESCE((v_result->>'ok')::boolean, false);
      ELSE v_ok := true;
      END IF;
    END IF;

    -- ── BRONZE-BRANCH ──
    IF NOT v_ok AND v_step_key = 'quality_council' AND NOT v_skipped THEN
      v_badge        := COALESCE(v_result->>'badge',  NEW.meta->>'badge');
      v_gate_score   := COALESCE(NULLIF(v_result->>'score','')::numeric,
                                 NULLIF(NEW.meta->>'score','')::numeric);
      v_rules_failed := COALESCE(NULLIF(v_result->>'rules_failed','')::int,
                                 NULLIF(NEW.meta->>'rules_failed','')::int, 0);
      IF v_badge = 'bronze' AND COALESCE(v_gate_score,0) >= 75 AND v_rules_failed <= 2 THEN
        v_is_bronze := true;
        v_ok := true;
      END IF;
    END IF;

    v_new_status := (CASE WHEN v_skipped THEN 'skipped'
                          WHEN v_ok      THEN 'done'
                          ELSE                'failed' END)::step_status;

    v_gate_status := CASE WHEN v_is_bronze THEN 'REVIEW_REQUIRED'
                          ELSE COALESCE(v_result->>'status', CASE WHEN v_ok THEN 'pass' ELSE 'fail' END) END;
    v_gate_score  := COALESCE(v_gate_score, NULLIF(v_result->>'score','')::numeric);

    v_gov_meta := jsonb_build_object(
      'executed', true, 'ok', v_ok, 'status', v_gate_status,
      'reconciled_from_job', NEW.id, 'reconciled_at', now(),
      'source_fn', 'fn_trg_job_complete_reconcile_step'
    );
    IF v_gate_score IS NOT NULL THEN
      v_gov_meta := v_gov_meta || jsonb_build_object('score', v_gate_score);
    END IF;
    IF v_is_bronze THEN
      v_gov_meta := v_gov_meta || jsonb_build_object(
        'verdict', jsonb_build_object('status','REVIEW_REQUIRED','badge','bronze'),
        'badge','bronze','bronze_branch', true
      );
      UPDATE public.course_packages
         SET feature_flags = COALESCE(feature_flags,'{}'::jsonb) || jsonb_build_object(
               'bronze', jsonb_build_object(
                  'repair_active', true, 'requires_review', true,
                  'set_at', now(), 'set_by', 'reconciler_bronze_branch',
                  'score', v_gate_score, 'rules_failed', v_rules_failed)),
             updated_at = now()
       WHERE id = NEW.package_id;
    END IF;

    UPDATE package_steps
       SET status = v_new_status,
           started_at  = COALESCE(started_at, NEW.started_at, NEW.created_at, now()),
           attempts    = GREATEST(COALESCE(attempts, 0), COALESCE(NEW.attempts, 1), 1),
           finished_at = COALESCE(finished_at, NEW.completed_at, now()),
           updated_at  = now(),
           last_error  = CASE WHEN v_ok OR v_skipped THEN NULL
                              ELSE format('GATE_FAIL: status=%s score=%s', v_gate_status, COALESCE(v_gate_score::text,'n/a')) END,
           meta        = COALESCE(meta, '{}'::jsonb) || v_gov_meta
     WHERE package_id = NEW.package_id AND step_key = v_step_key
       AND status NOT IN ('done'::step_status,'skipped'::step_status);
  ELSE
    IF v_skipped THEN v_nongov_ok := true;
    ELSE
      v_nongov_ok := COALESCE((v_result->>'ok')::boolean,(v_result->>'success')::boolean,(v_result->>'passed')::boolean,true);
    END IF;
    v_new_status := (CASE WHEN v_skipped THEN 'skipped' ELSE 'done' END)::step_status;
    v_nongov_meta := jsonb_build_object('executed', true, 'ok', v_nongov_ok,
      'reconciled_from_job', NEW.id, 'reconciled_at', now(),
      'source_fn', 'fn_trg_job_complete_reconcile_step');
    UPDATE package_steps
       SET status = v_new_status,
           started_at  = COALESCE(started_at, NEW.started_at, NEW.created_at, now()),
           attempts    = GREATEST(COALESCE(attempts, 0), COALESCE(NEW.attempts, 1), 1),
           finished_at = COALESCE(finished_at, NEW.completed_at, now()),
           updated_at  = now(),
           meta        = COALESCE(meta, '{}'::jsonb) || v_nongov_meta
     WHERE package_id = NEW.package_id AND step_key = v_step_key
       AND status NOT IN ('done'::step_status,'skipped'::step_status);
  END IF;

  RETURN NEW;
END;
$function$;

-- Selbsttest-RPC: Sub-TX über BEGIN/EXCEPTION mit RAISE → DB-Rollback,
-- plpgsql-Variablen bleiben erhalten.
CREATE OR REPLACE FUNCTION public.admin_test_heal_contract(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_dag_block jsonb;
  v_retry jsonb;
  v_step_status_before text;
  v_step_status_after  text;
  v_jobs_before int := 0;
  v_jobs_after  int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM course_packages WHERE id = p_package_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'package_not_found');
  END IF;

  -- Test 1: DAG-Block-Pfad
  BEGIN
    INSERT INTO job_queue (job_type, status, payload, package_id, created_at)
    VALUES ('package_quality_council', 'running',
            jsonb_build_object('package_id', p_package_id, 'step_key','quality_council','_test', true),
            p_package_id, now());
    v_dag_block := admin_retry_failed_step(p_package_id, 'quality_council', 'self_test_dag_block');
    RAISE EXCEPTION 'EXAMFIT_ROLLBACK_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'EXAMFIT_ROLLBACK_OK' AND v_dag_block IS NULL THEN
      v_dag_block := jsonb_build_object('ok', false, 'reason', SQLERRM);
    END IF;
  END;

  -- Test 2: Retry-Pfad
  BEGIN
    SELECT status::text INTO v_step_status_before FROM package_steps
     WHERE package_id = p_package_id AND step_key = 'quality_council';
    SELECT COUNT(*) INTO v_jobs_before FROM job_queue
     WHERE package_id = p_package_id AND job_type = 'package_quality_council';

    UPDATE package_steps SET status = 'failed', last_error = 'self_test_setup'
     WHERE package_id = p_package_id AND step_key = 'quality_council';

    v_retry := admin_retry_failed_step(p_package_id, 'quality_council', 'self_test_retry');

    SELECT status::text INTO v_step_status_after FROM package_steps
     WHERE package_id = p_package_id AND step_key = 'quality_council';
    SELECT COUNT(*) INTO v_jobs_after FROM job_queue
     WHERE package_id = p_package_id AND job_type = 'package_quality_council';
    RAISE EXCEPTION 'EXAMFIT_ROLLBACK_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'EXAMFIT_ROLLBACK_OK' AND v_retry IS NULL THEN
      v_retry := jsonb_build_object('ok', false, 'reason', SQLERRM);
    END IF;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'dag_block', jsonb_build_object(
      'rpc_result', v_dag_block,
      'pass', COALESCE((v_dag_block->>'skipped')::boolean,false) = true
              AND v_dag_block->>'reason' = 'jobs_already_running'
    ),
    'retry', jsonb_build_object(
      'rpc_result', v_retry,
      'step_status_before', v_step_status_before,
      'step_status_after',  v_step_status_after,
      'jobs_before', v_jobs_before,
      'jobs_after',  v_jobs_after,
      'pass', COALESCE((v_retry->>'ok')::boolean,false) = true
              AND v_step_status_after IN ('queued','enqueued','running')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_test_heal_contract(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_test_heal_contract(uuid) TO authenticated;
