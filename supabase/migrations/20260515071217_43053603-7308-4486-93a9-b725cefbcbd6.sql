-- ============================================================
-- 1) View: v_publish_tail_blockers
-- ============================================================
CREATE OR REPLACE VIEW public.v_publish_tail_blockers AS
WITH base AS (
  SELECT
    cp.id AS package_id,
    cp.title,
    cp.status,
    cp.pipeline_mode::text AS track,
    cp.feature_flags,
    public.fn_is_bronze_locked(cp.id) AS bronze_locked,
    (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id = cp.id AND eq.status='approved') AS approved_questions,
    (SELECT COUNT(*) FROM package_steps ps WHERE ps.package_id = cp.id) AS steps_total,
    (SELECT COUNT(*) FROM package_steps ps WHERE ps.package_id = cp.id AND ps.status='done') AS steps_done,
    (SELECT COUNT(*) FROM package_steps ps
       WHERE ps.package_id = cp.id AND ps.status='failed'
         AND (ps.last_error IS NULL OR ps.last_error NOT ILIKE '%TERMINAL%')) AS steps_failed_retriable,
    (SELECT COUNT(*) FROM package_steps ps
       WHERE ps.package_id = cp.id AND ps.status='failed' AND ps.last_error ILIKE '%TERMINAL%') AS steps_failed_terminal,
    (SELECT COUNT(*) FROM package_steps ps
       WHERE ps.package_id = cp.id AND ps.status='skipped'
         AND (ps.last_error ILIKE '%PATTERN_X8%' OR ps.last_error ILIKE '%parked%' OR ps.last_error ILIKE '%cooldown%')) AS steps_parked,
    (SELECT MAX(updated_at) FROM package_steps ps WHERE ps.package_id = cp.id) AS last_step_activity,
    -- auto_publish step state
    (SELECT row_to_json(t)::jsonb FROM (
       SELECT ps.status, ps.last_error, ps.updated_at, ps.started_at, ps.finished_at
       FROM package_steps ps WHERE ps.package_id = cp.id AND ps.step_key='auto_publish'
     ) t) AS auto_publish_step,
    public.fn_package_publish_readiness(cp.id) AS readiness
  FROM course_packages cp
  WHERE cp.status IN ('building','done','queued','blocked')
),
classified AS (
  SELECT b.*,
    CASE
      WHEN b.bronze_locked THEN 'BRONZE_LOCKED'
      WHEN (b.readiness->'pricing'->>'ready')::boolean IS DISTINCT FROM true THEN 'PRICING_BLOCKED'
      WHEN b.steps_failed_retriable > 0 THEN 'JOB_FAILED_RETRIABLE'
      WHEN b.steps_failed_terminal > 0 THEN 'GUARD_MATRIX_MISMATCH'
      WHEN b.steps_parked > 0 THEN 'JOB_PARKED'
      WHEN b.approved_questions >= 50
           AND (b.readiness->>'steps_not_done')::int = 0
           AND b.status IN ('done','building') THEN 'STEP_RECONCILE_DRIFT'
      WHEN b.approved_questions < 50 THEN 'ARTIFACT_MISSING'
      ELSE 'UNKNOWN'
    END AS root_cause,
    CASE
      WHEN b.approved_questions >= 50 THEN true ELSE false
    END AS effective_quality_ready
  FROM base b
)
SELECT
  package_id, title, status, track,
  approved_questions, steps_total, steps_done,
  steps_failed_retriable, steps_failed_terminal, steps_parked,
  last_step_activity, auto_publish_step,
  bronze_locked,
  effective_quality_ready,
  root_cause,
  readiness AS publish_readiness,
  CASE root_cause
    WHEN 'STEP_RECONCILE_DRIFT' THEN 'safe_auto_heal'
    WHEN 'JOB_FAILED_RETRIABLE' THEN 'safe_auto_heal'
    WHEN 'JOB_PARKED' THEN 'safe_auto_heal'
    WHEN 'ARTIFACT_MISSING' THEN 'enqueue_tail_job'
    WHEN 'BRONZE_LOCKED' THEN 'manual_review_required'
    WHEN 'PRICING_BLOCKED' THEN 'manual_review_required'
    WHEN 'GUARD_MATRIX_MISMATCH' THEN 'manual_review_required'
    ELSE 'manual_review_required'
  END AS recommendation
FROM classified
WHERE effective_quality_ready = true OR steps_failed_retriable > 0 OR steps_parked > 0;

REVOKE ALL ON public.v_publish_tail_blockers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_publish_tail_blockers TO service_role;

-- ============================================================
-- 2) RPC: admin_get_publish_tail_blockers
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_publish_tail_blockers(p_limit int DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'access_denied: admin role required';
  END IF;

  SELECT jsonb_agg(to_jsonb(t.*) ORDER BY
    CASE t.recommendation WHEN 'safe_auto_heal' THEN 0 WHEN 'enqueue_tail_job' THEN 1 ELSE 2 END,
    t.approved_questions DESC)
  INTO v_rows
  FROM (
    SELECT * FROM public.v_publish_tail_blockers
    ORDER BY approved_questions DESC
    LIMIT p_limit
  ) t;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES (
    'publish_tail_diagnosed','system','success',
    format('Diagnosed %s publish-tail blockers', COALESCE(jsonb_array_length(v_rows),0)),
    jsonb_build_object('limit', p_limit, 'requested_by', v_uid::text)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'count', COALESCE(jsonb_array_length(v_rows),0),
    'blockers', COALESCE(v_rows, '[]'::jsonb),
    'evaluated_at', now()
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_get_publish_tail_blockers(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_publish_tail_blockers(int) TO authenticated, service_role;

-- ============================================================
-- 3) RPC: admin_run_publish_tail_reconciler
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_run_publish_tail_reconciler(
  p_dry_run boolean DEFAULT true,
  p_limit int DEFAULT 20,
  p_package_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
  v_actions jsonb := '[]'::jsonb;
  v_action jsonb;
  v_healed int := 0;
  v_unresolved int := 0;
  v_skipped int := 0;
  v_reconcile_count int;
  v_retry_result jsonb;
  v_step record;
  v_correlation uuid;
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

    -- Branch by root cause
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
      -- Reconcile: approved questions exist + steps_not_done says 0 but status not published.
      -- Safe: just enqueue auto_publish via standard path
      IF p_dry_run THEN
        v_action := v_action || jsonb_build_object('outcome','would_requeue_auto_publish');
      ELSE
        UPDATE package_steps SET status='queued', updated_at=now(), last_error=NULL
          WHERE package_id = v_row.package_id AND step_key='auto_publish' AND status IN ('failed','skipped');
        v_correlation := gen_random_uuid();
        INSERT INTO job_queue (job_type, payload, status, priority, job_name, correlation_id, root_job_id)
        VALUES (
          'package_auto_publish',
          jsonb_build_object('package_id', v_row.package_id::text, 'enqueue_source','publish_tail_reconciler'),
          'pending', 5,
          'publish_tail_reconciler|'||v_row.package_id::text,
          v_correlation, v_correlation
        );
        v_healed := v_healed + 1;
        v_action := v_action || jsonb_build_object('outcome','auto_publish_requeued');
        INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('publish_tail_auto_publish_requeued','course_package', v_row.package_id::text,'success',
                'Reconciled drift: enqueued auto_publish via standard path',
                jsonb_build_object('correlation_id', v_correlation, 'root_cause', v_row.root_cause));
      END IF;

    ELSIF v_row.root_cause = 'JOB_FAILED_RETRIABLE' THEN
      IF p_dry_run THEN
        v_action := v_action || jsonb_build_object('outcome','would_retry_failed_steps','count',v_row.steps_failed_retriable);
      ELSE
        v_reconcile_count := 0;
        FOR v_step IN
          SELECT step_key FROM package_steps
          WHERE package_id = v_row.package_id AND status='failed'
            AND (last_error IS NULL OR last_error NOT ILIKE '%TERMINAL%')
        LOOP
          BEGIN
            v_retry_result := admin_retry_failed_step(v_row.package_id, v_step.step_key, 'publish_tail_reconciler');
            v_reconcile_count := v_reconcile_count + 1;
            INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
            VALUES ('publish_tail_job_requeued','package_step', v_step.step_key,'success',
                    'Retried failed step',
                    jsonb_build_object('package_id',v_row.package_id,'result',v_retry_result));
          EXCEPTION WHEN OTHERS THEN
            INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
            VALUES ('publish_tail_job_requeued','package_step', v_step.step_key,'error', SQLERRM,
                    jsonb_build_object('package_id',v_row.package_id));
          END;
        END LOOP;
        v_healed := v_healed + 1;
        v_action := v_action || jsonb_build_object('outcome','retried_failed_steps','count',v_reconcile_count);
      END IF;

    ELSIF v_row.root_cause = 'JOB_PARKED' THEN
      -- Unpark: only steps with PATTERN_X8/parked/cooldown in last_error → reset to queued
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

  -- Summary audit
  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES (
    'publish_tail_reconciled','system',
    CASE WHEN v_healed > 0 THEN 'success' WHEN v_unresolved > 0 THEN 'partial' ELSE 'noop' END,
    format('Reconciler run: healed=%s unresolved=%s skipped=%s dry_run=%s',
      v_healed, v_unresolved, v_skipped, p_dry_run),
    jsonb_build_object('dry_run',p_dry_run,'healed',v_healed,'unresolved',v_unresolved,'skipped',v_skipped,
      'actions', v_actions, 'requested_by', v_uid::text)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'healed', v_healed,
    'unresolved', v_unresolved,
    'skipped', v_skipped,
    'actions', v_actions,
    'evaluated_at', now()
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_run_publish_tail_reconciler(boolean,int,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_publish_tail_reconciler(boolean,int,uuid[]) TO authenticated, service_role;

-- ============================================================
-- 4) Smoke audit (dry-run baseline) — service_role bypass for migration context
-- ============================================================
INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
SELECT 'publish_tail_diagnosed','system','success',
  format('Baseline: %s tail blockers detected', COUNT(*)),
  jsonb_build_object('baseline','migration_install', 'by_root_cause',
    jsonb_object_agg(root_cause, cnt))
FROM (
  SELECT root_cause, COUNT(*) AS cnt FROM public.v_publish_tail_blockers GROUP BY root_cause
) s;