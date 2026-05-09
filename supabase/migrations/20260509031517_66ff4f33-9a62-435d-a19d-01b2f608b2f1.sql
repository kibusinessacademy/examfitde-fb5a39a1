-- Forensic Manual Heal — 2026-05-09 (corrected: auto_heal_log uses 'metadata' col)

DO $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_drift_jobs int := 0;
  v_active_jobs int := 0;
  v_failed_reenq int := 0;
  v_bronze_jobs int := 0;
BEGIN
  PERFORM set_config('app.transition_source', 'forensic_manual_heal_2026_05_09:'||v_run_id::text, true);

  -- 1) Bump priority + run_after for all DAG-blocked pendings
  WITH targets AS (
    SELECT DISTINCT job_id, block_reason, bronze_locked
    FROM v_dag_blocked_jobs
  ),
  upd AS (
    UPDATE job_queue jq
       SET priority    = LEAST(COALESCE(jq.priority, 0), -50),
           run_after   = now(),
           scheduled_at= now(),
           updated_at  = now(),
           payload     = CASE
                           WHEN t.bronze_locked
                             THEN COALESCE(jq.payload,'{}'::jsonb)
                                  || jsonb_build_object(
                                       'bronze_lock_override', true,
                                       'forensic_heal_run_id', v_run_id)
                           ELSE COALESCE(jq.payload,'{}'::jsonb)
                                || jsonb_build_object('forensic_heal_run_id', v_run_id)
                         END,
           meta        = COALESCE(jq.meta,'{}'::jsonb)
                         || jsonb_build_object(
                              'forensic_heal_run_id', v_run_id,
                              'forensic_heal_block_reason', t.block_reason,
                              'forensic_heal_at', now())
      FROM targets t
     WHERE jq.id = t.job_id
       AND jq.status = 'pending'
    RETURNING jq.id, t.block_reason, t.bronze_locked
  )
  SELECT
    COUNT(*) FILTER (WHERE block_reason = 'parent_done_drift'),
    COUNT(*) FILTER (WHERE block_reason = 'parent_active'),
    COUNT(*) FILTER (WHERE bronze_locked)
  INTO v_drift_jobs, v_active_jobs, v_bronze_jobs
  FROM upd;

  -- 2) parent_failed: parent step → queued + fresh job
  WITH failed_parents AS (
    SELECT DISTINCT package_id, parent_step_key
    FROM v_dag_blocked_jobs
    WHERE block_reason = 'parent_failed' AND parent_step_key IS NOT NULL
  ),
  reset_step AS (
    UPDATE package_steps ps
       SET status = 'queued',
           last_error = NULL,
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
                    'forensic_heal_run_id', v_run_id,
                    'forensic_reset_at', now())
      FROM failed_parents fp
     WHERE ps.package_id = fp.package_id
       AND ps.step_key = fp.parent_step_key
    RETURNING ps.package_id, ps.step_key
  ),
  enq AS (
    INSERT INTO job_queue (job_type, package_id, status, run_after, scheduled_at, priority, payload, meta)
    SELECT 'package_'||rs.step_key,
           rs.package_id,
           'pending',
           now(), now(), -100,
           jsonb_build_object(
             'package_id', rs.package_id,
             'enqueue_source', 'forensic_manual_heal_2026_05_09',
             'bronze_lock_override', true,
             'forensic_heal_run_id', v_run_id
           ),
           jsonb_build_object(
             'enqueue_source', 'forensic_manual_heal_2026_05_09',
             'forensic_heal_run_id', v_run_id
           )
      FROM reset_step rs
     WHERE NOT EXISTS (
       SELECT 1 FROM job_queue x
        WHERE x.package_id = rs.package_id
          AND x.job_type   = 'package_'||rs.step_key
          AND x.status IN ('pending','processing')
     )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_failed_reenq FROM enq;

  -- 3) Audit
  INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata, trigger_source)
  VALUES (
    'forensic_manual_heal_2026_05_09',
    'system',
    'success',
    jsonb_build_object(
      'run_id', v_run_id,
      'parent_done_drift_bumped', v_drift_jobs,
      'parent_active_bumped', v_active_jobs,
      'failed_parents_reenqueued', v_failed_reenq,
      'bronze_jobs_unlocked', v_bronze_jobs
    ),
    'manual_forensic_sprint'
  );

  RAISE NOTICE 'Forensic heal % done. drift=% active=% reenqueued=% bronze_overridden=%',
    v_run_id, v_drift_jobs, v_active_jobs, v_failed_reenq, v_bronze_jobs;
END $$;

-- 4) cta_visible alarm: traffic-aware gate (avoid night-time false positives)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'fn_alert_cta_visible_stall'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.fn_alert_cta_visible_stall()
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      DECLARE
        v_c1h int; v_c24h int; v_c48h int; v_traffic_baseline_3h int;
      BEGIN
        SELECT
          COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour'),
          COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours'),
          COUNT(*) FILTER (WHERE created_at > now() - interval '48 hours')
        INTO v_c1h, v_c24h, v_c48h
        FROM conversion_events
        WHERE event_type = 'cta_visible';

        SELECT COUNT(*)
          INTO v_traffic_baseline_3h
          FROM conversion_events
         WHERE created_at BETWEEN now() - interval '4 hours' AND now() - interval '1 hour'
           AND event_type IN ('page_view','lead_magnet_view','quiz_started','cta_visible','cta_click');

        IF v_c1h = 0 AND v_c24h > 0 AND v_traffic_baseline_3h >= 10 THEN
          RETURN jsonb_build_object(
            'alarm', true,
            'severity', 'warning',
            'key', 'launch.tracking.cta_visible_stall',
            'counts', jsonb_build_object('c1h', v_c1h, 'c24h', v_c24h, 'c48h', v_c48h, 'event_type','cta_visible'),
            'traffic_baseline_3h', v_traffic_baseline_3h
          );
        END IF;

        RETURN jsonb_build_object(
          'alarm', false,
          'counts', jsonb_build_object('c1h', v_c1h, 'c24h', v_c24h, 'c48h', v_c48h, 'event_type','cta_visible'),
          'traffic_baseline_3h', v_traffic_baseline_3h,
          'suppressed_reason', CASE
            WHEN v_c24h = 0 THEN 'no_24h_baseline'
            WHEN v_traffic_baseline_3h < 10 THEN 'no_recent_traffic'
            ELSE NULL END
        );
      END;
      $body$;
    $f$;

    INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata, trigger_source)
    VALUES (
      'forensic_manual_heal_2026_05_09',
      'alarm_definition',
      'success',
      jsonb_build_object('alarm','cta_visible_stall','change','traffic_aware_gate_added'),
      'manual_forensic_sprint'
    );
  END IF;
END $$;
