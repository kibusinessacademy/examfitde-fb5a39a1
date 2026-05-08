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
  v_badge text;
  v_rules_failed int;
  v_is_bronze boolean := false;
  v_unlock_rows int;
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

    -- ── BRONZE AUTO-UNLOCK ──
    -- Wenn ein Folge-Council CLEAN passed (badge!=bronze, ok=true) und das Paket
    -- noch im Bronze-Lock steckt, automatisch entsperren — kein manueller Eingriff nötig.
    IF v_step_key = 'quality_council' AND v_ok AND NOT v_is_bronze AND NOT v_skipped THEN
      UPDATE public.course_packages
         SET feature_flags = jsonb_set(
               COALESCE(feature_flags,'{}'::jsonb),
               '{bronze}',
               COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
                 'requires_review', false,
                 'repair_active', false,
                 'auto_cleared_at', now(),
                 'auto_cleared_by', 'reconciler_bronze_autounlock',
                 'auto_cleared_score', v_gate_score,
                 'auto_cleared_badge', v_badge,
                 'final_state', 'cleared',
                 'final_state_at', now()
               )
             ),
             updated_at = now()
       WHERE id = NEW.package_id
         AND feature_flags->'bronze'->>'requires_review' = 'true';
      GET DIAGNOSTICS v_unlock_rows = ROW_COUNT;
      IF v_unlock_rows > 0 THEN
        INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
        VALUES ('fn_trg_job_complete_reconcile_step','bronze_auto_unlocked',
                NEW.package_id::text, 'package','success',
                format('Bronze auto-cleared: score=%s badge=%s', COALESCE(v_gate_score::text,'n/a'), COALESCE(v_badge,'n/a')),
                jsonb_build_object('package_id', NEW.package_id, 'score', v_gate_score, 'badge', v_badge, 'job_id', NEW.id, 'job_type', NEW.job_type));
      END IF;
    END IF;
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