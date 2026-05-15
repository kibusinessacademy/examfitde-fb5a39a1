-- Reconciler v1.1: Eliminate manual job_queue INSERT and admin_retry_failed_step path.
-- Both STEP_RECONCILE_DRIFT and JOB_FAILED_RETRIABLE now ONLY reset package_steps.status
-- to 'queued' and rely on trg_atomic_enqueue to create the job with the correct
-- SSOT-compliant payload (package_id + curriculum_id + step_key + enqueue_source).
-- This removes the SSOT VIOLATION (missing curriculum_id) that the manual INSERT triggered.
-- No force-publish, no bronze bypass, no status mutation to 'published'.

CREATE OR REPLACE FUNCTION public.admin_run_publish_tail_reconciler(
  p_dry_run boolean DEFAULT true,
  p_limit integer DEFAULT 20,
  p_package_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
  v_actions jsonb := '[]'::jsonb;
  v_action jsonb;
  v_healed int := 0;
  v_unresolved int := 0;
  v_skipped int := 0;
  v_reconcile_count int;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'access_denied: admin role required';
  END IF;

  FOR v_row IN
    SELECT * FROM public.v_publish_tail_blockers
    WHERE (p_package_ids IS NULL OR package_id = ANY(p_package_ids))
    ORDER BY
      CASE recommendation WHEN 'safe_auto_heal' THEN 0 WHEN 'enqueue_tail_job' THEN 1 ELSE 2 END,
      approved_questions DESC
    LIMIT p_limit
  LOOP
    v_action := jsonb_build_object(
      'package_id', v_row.package_id,
      'title', v_row.title,
      'root_cause', v_row.root_cause,
      'recommendation', v_row.recommendation,
      'dry_run', p_dry_run
    );

    IF v_row.root_cause IN ('BRONZE_LOCKED','PRICING_BLOCKED','GUARD_MATRIX_MISMATCH','UNKNOWN') THEN
      v_unresolved := v_unresolved + 1;
      v_action := v_action || jsonb_build_object('outcome','unresolved','reason',v_row.root_cause);
      IF NOT p_dry_run THEN
        INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('publish_tail_unresolved','course_package', v_row.package_id::text, 'noop',
                'Manual review required: ' || v_row.root_cause,
                jsonb_build_object('root_cause',v_row.root_cause,'readiness',v_row.publish_readiness));
      END IF;

    ELSIF v_row.root_cause = 'STEP_RECONCILE_DRIFT' THEN
      -- v1.1: NO manual job_queue INSERT. Step-reset only; trg_atomic_enqueue creates the job.
      IF p_dry_run THEN
        v_action := v_action || jsonb_build_object('outcome','would_reset_auto_publish_step');
      ELSE
        UPDATE package_steps
           SET status='queued', updated_at=now(), last_error=NULL
         WHERE package_id = v_row.package_id
           AND step_key='auto_publish'
           AND status IN ('failed','skipped','queued');
        GET DIAGNOSTICS v_reconcile_count = ROW_COUNT;
        v_healed := v_healed + 1;
        v_action := v_action || jsonb_build_object('outcome','auto_publish_step_reset','rows',v_reconcile_count);
        INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('publish_tail_step_reset','course_package', v_row.package_id::text,'success',
                'Reset auto_publish step → queued; trg_atomic_enqueue handles job creation with SSOT payload',
                jsonb_build_object('root_cause',v_row.root_cause,'rows_reset',v_reconcile_count,
                                   'enqueue_path','trg_atomic_enqueue'));
      END IF;

    ELSIF v_row.root_cause = 'JOB_FAILED_RETRIABLE' THEN
      -- v1.1: NO admin_retry_failed_step (which used manual INSERT lacking curriculum_id).
      -- Reset failed steps → queued; trg_atomic_enqueue creates jobs with correct payload.
      IF p_dry_run THEN
        v_action := v_action || jsonb_build_object('outcome','would_reset_failed_steps','count',v_row.steps_failed_retriable);
      ELSE
        UPDATE package_steps
           SET status='queued', updated_at=now(), last_error=NULL
         WHERE package_id = v_row.package_id
           AND status='failed'
           AND (last_error IS NULL OR last_error NOT ILIKE '%TERMINAL%');
        GET DIAGNOSTICS v_reconcile_count = ROW_COUNT;
        v_healed := v_healed + 1;
        v_action := v_action || jsonb_build_object('outcome','failed_steps_reset','count',v_reconcile_count);
        INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('publish_tail_failed_steps_reset','course_package', v_row.package_id::text,'success',
                format('Reset %s failed step(s) → queued; trg_atomic_enqueue handles job creation', v_reconcile_count),
                jsonb_build_object('root_cause',v_row.root_cause,'rows_reset',v_reconcile_count,
                                   'enqueue_path','trg_atomic_enqueue'));
      END IF;

    ELSIF v_row.root_cause = 'JOB_PARKED' THEN
      IF p_dry_run THEN
        v_action := v_action || jsonb_build_object('outcome','would_unpark','count',v_row.steps_parked);
      ELSE
        UPDATE package_steps SET status='queued', last_error=NULL, updated_at=now()
          WHERE package_id = v_row.package_id AND status='skipped'
            AND (last_error ILIKE '%PATTERN_X8%' OR last_error ILIKE '%parked%' OR last_error ILIKE '%cooldown%');
        GET DIAGNOSTICS v_reconcile_count = ROW_COUNT;
        v_healed := v_healed + 1;
        v_action := v_action || jsonb_build_object('outcome','unparked_steps','count',v_reconcile_count);
        INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('publish_tail_reconciled','course_package', v_row.package_id::text,'success',
                format('Unparked %s steps', v_reconcile_count),
                jsonb_build_object('root_cause','JOB_PARKED','count',v_reconcile_count));
      END IF;

    ELSIF v_row.root_cause = 'ARTIFACT_MISSING' THEN
      IF p_dry_run THEN
        v_action := v_action || jsonb_build_object('outcome','would_enqueue_nudge');
      ELSE
        BEGIN
          PERFORM admin_nudge_atomic_trigger(v_row.package_id, false);
          v_healed := v_healed + 1;
          v_action := v_action || jsonb_build_object('outcome','nudge_triggered');
          INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
          VALUES ('publish_tail_artifact_generation_enqueued','course_package', v_row.package_id::text,'success',
                  'Nudged package to fill missing artifacts',
                  jsonb_build_object('approved_questions',v_row.approved_questions));
        EXCEPTION WHEN OTHERS THEN
          v_skipped := v_skipped + 1;
          v_action := v_action || jsonb_build_object('outcome','nudge_failed','error',SQLERRM);
        END;
      END IF;

    ELSE
      v_skipped := v_skipped + 1;
      v_action := v_action || jsonb_build_object('outcome','skipped_unhandled');
    END IF;

    v_actions := v_actions || jsonb_build_array(v_action);
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES (
    'publish_tail_reconciled','system',
    CASE WHEN v_healed > 0 THEN 'success' WHEN v_unresolved > 0 THEN 'partial' ELSE 'noop' END,
    format('Reconciler v1.1 run: healed=%s unresolved=%s skipped=%s dry_run=%s',
      v_healed, v_unresolved, v_skipped, p_dry_run),
    jsonb_build_object('version','v1.1','dry_run',p_dry_run,'healed',v_healed,
      'unresolved',v_unresolved,'skipped',v_skipped,'actions', v_actions, 'requested_by', v_uid::text)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'version', 'v1.1',
    'dry_run', p_dry_run,
    'healed', v_healed,
    'unresolved', v_unresolved,
    'skipped', v_skipped,
    'actions', v_actions,
    'evaluated_at', now()
  );
END $function$;