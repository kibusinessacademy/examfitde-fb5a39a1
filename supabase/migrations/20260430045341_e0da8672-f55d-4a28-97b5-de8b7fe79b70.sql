CREATE OR REPLACE FUNCTION public.fn_detect_and_heal_exam_pool_enqueue_drift(
  p_max_per_run integer DEFAULT 25,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started_at timestamptz := now();
  v_candidates jsonb := '[]'::jsonb;
  v_healed_ids uuid[] := ARRAY[]::uuid[];
  v_skipped jsonb := '[]'::jsonb;
  v_total_candidates int := 0;
  v_healed_count int := 0;
  v_skipped_count int := 0;
  v_no_step_count int := 0;
  v_already_done_count int := 0;
  v_failed_count int := 0;
  r record;
  v_affected int;
  v_result jsonb;
BEGIN
  -- Snapshot Kandidaten
  CREATE TEMP TABLE _drift_candidates ON COMMIT DROP AS
  SELECT
    cp.id AS package_id,
    cp.title,
    cp.status AS pkg_status,
    ps.id AS step_id,
    ps.status::text AS step_status,
    ps.updated_at AS step_updated_at,
    EXTRACT(EPOCH FROM (now() - ps.updated_at))::int AS step_age_s,
    (SELECT COUNT(*)::int FROM exam_questions eq WHERE eq.package_id=cp.id AND eq.status='approved') AS approved_q
  FROM course_packages cp
  LEFT JOIN package_steps ps
    ON ps.package_id = cp.id AND ps.step_key = 'package_generate_exam_pool'
  WHERE cp.archived = false
    AND cp.is_published = false
    AND cp.status = 'building'
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.job_type = 'package_generate_exam_pool'
        AND jq.status IN ('pending','processing','queued','running','batch_pending')
    )
    AND (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=cp.id AND eq.status='approved') < 50
  ORDER BY cp.last_progress_at NULLS FIRST
  LIMIT p_max_per_run;

  SELECT COUNT(*) INTO v_total_candidates FROM _drift_candidates;

  -- Wenn nichts gefunden → trotzdem loggen mit explizitem Grund
  IF v_total_candidates = 0 THEN
    INSERT INTO auto_heal_log (action_type, target_type, metadata, result_status, duration_ms)
    VALUES (
      'exam_pool_drift_detection','system',
      jsonb_build_object(
        'reason','no_drift_detected',
        'note','No building packages with <50 approved questions are missing an active exam_pool job. System healthy on this dimension.',
        'max_per_run',p_max_per_run,
        'dry_run',p_dry_run,
        'checked_at',v_started_at
      ),
      'noop',
      EXTRACT(MILLISECONDS FROM (clock_timestamp()-v_started_at))::int
    );
    RETURN jsonb_build_object(
      'total_candidates',0,
      'healed',0,
      'skipped',0,
      'reason','no_drift_detected'
    );
  END IF;

  -- Pro Kandidat heilen oder skippen
  FOR r IN SELECT * FROM _drift_candidates LOOP
    v_candidates := v_candidates || jsonb_build_object(
      'package_id', r.package_id,
      'title', r.title,
      'step_status', r.step_status,
      'step_age_s', r.step_age_s,
      'approved_q', r.approved_q
    );

    -- Kein step-Eintrag → Pipeline-Trigger nudgen
    IF r.step_id IS NULL THEN
      v_no_step_count := v_no_step_count + 1;
      v_skipped := v_skipped || jsonb_build_object(
        'package_id', r.package_id,
        'reason','no_step_row_use_nudge_atomic_trigger'
      );
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    -- Step bereits done/skipped → Drift ist falsch positiv
    IF r.step_status IN ('done','skipped','running') THEN
      v_already_done_count := v_already_done_count + 1;
      v_skipped := v_skipped || jsonb_build_object(
        'package_id', r.package_id,
        'reason','step_status_terminal_or_running:' || r.step_status
      );
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    -- Heilen: status auf 'queued' → Trigger fn_atomic_enqueue_on_step_queued enqueued den Job
    IF NOT p_dry_run THEN
      BEGIN
        UPDATE package_steps
           SET status = 'queued',
               meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
                 'exam_pool_drift_healed_at', now(),
                 'exam_pool_drift_prev_status', r.step_status,
                 'exam_pool_drift_age_s', r.step_age_s
               ),
               updated_at = now()
         WHERE id = r.step_id
           AND status::text = r.step_status;
        GET DIAGNOSTICS v_affected = ROW_COUNT;

        IF v_affected > 0 THEN
          v_healed_count := v_healed_count + 1;
          v_healed_ids := array_append(v_healed_ids, r.package_id);
        ELSE
          v_skipped_count := v_skipped_count + 1;
          v_skipped := v_skipped || jsonb_build_object(
            'package_id', r.package_id,
            'reason','step_status_changed_concurrently'
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_failed_count := v_failed_count + 1;
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', r.package_id,
          'reason','update_failed:' || SQLERRM
        );
      END;
    END IF;
  END LOOP;

  DROP TABLE IF EXISTS _drift_candidates;

  v_result := jsonb_build_object(
    'total_candidates', v_total_candidates,
    'healed', v_healed_count,
    'skipped', v_skipped_count,
    'no_step_row', v_no_step_count,
    'already_done_or_running', v_already_done_count,
    'update_failed', v_failed_count,
    'healed_ids', v_healed_ids,
    'dry_run', p_dry_run
  );

  INSERT INTO auto_heal_log (action_type, target_type, metadata, result_status, duration_ms)
  VALUES (
    'exam_pool_drift_detection','system',
    jsonb_build_object(
      'summary', v_result,
      'candidates', v_candidates,
      'skip_details', v_skipped,
      'max_per_run', p_max_per_run,
      'dry_run', p_dry_run,
      'checked_at', v_started_at
    ),
    CASE
      WHEN v_healed_count > 0 THEN 'success'
      WHEN v_failed_count > 0 THEN 'partial'
      WHEN p_dry_run THEN 'dry_run'
      ELSE 'noop'
    END,
    EXTRACT(MILLISECONDS FROM (clock_timestamp()-v_started_at))::int
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_detect_and_heal_exam_pool_enqueue_drift(integer,boolean)
TO authenticated, service_role;