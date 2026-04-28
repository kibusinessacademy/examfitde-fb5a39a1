-- Forensic 24h Heal v3 — correct admin_step_reset_detailed signature + admin_nudge_atomic_trigger
DO $$
DECLARE
  r RECORD;
  v_active INT;
  v_heal_count INT := 0;
  v_skip_count INT := 0;
  v_fail_count INT := 0;
  v_action TEXT := 'FORENSIC_24H_HEAL_2026_04_28_V3';
  v_started TIMESTAMPTZ;
BEGIN
  FOR r IN
    WITH classified AS (
      SELECT
        j.package_id,
        COALESCE(j.meta->>'step_key', regexp_replace(j.job_type,'^package_','')) AS step_key,
        string_agg(DISTINCT
          CASE
            WHEN COALESCE(j.meta->>'cancel_reason', j.last_error,'') ILIKE '%MAX_ATTEMPTS_EXHAUSTED%' THEN 'MAX_ATTEMPTS'
            WHEN COALESCE(j.meta->>'cancel_reason', j.last_error,'') ILIKE '%STALE_PROCESSING_EXHAUSTED%' THEN 'STALE_EXHAUSTED'
            WHEN COALESCE(j.meta->>'cancel_reason', j.last_error,'') ILIKE '%TERMINAL_LOOP%' THEN 'TERMINAL_LOOP'
            WHEN COALESCE(j.meta->>'cancel_reason', j.last_error,'') ILIKE '%POISONED_LOOP%' THEN 'POISONED_LOOP'
            WHEN COALESCE(j.meta->>'cancel_reason', j.last_error,'') ILIKE '%REQUEUE_LOOP_KILLED%' THEN 'REQUEUE_LOOP_KILLED'
            WHEN COALESCE(j.meta->>'cancel_reason', j.last_error,'') ILIKE '%HOTLOOP_QUARANTINE%' THEN 'HOTLOOP_Q'
          END, ',') AS patterns
      FROM job_queue j
      WHERE j.status IN ('failed','cancelled')
        AND COALESCE(j.completed_at, j.updated_at) > now() - interval '24 hours'
        AND j.package_id IS NOT NULL
        AND (
          COALESCE(j.meta->>'cancel_reason', j.last_error,'') ILIKE '%MAX_ATTEMPTS_EXHAUSTED%'
          OR COALESCE(j.meta->>'cancel_reason', j.last_error,'') ILIKE '%STALE_PROCESSING_EXHAUSTED%'
          OR COALESCE(j.meta->>'cancel_reason', j.last_error,'') ILIKE '%TERMINAL_LOOP%'
          OR COALESCE(j.meta->>'cancel_reason', j.last_error,'') ILIKE '%POISONED_LOOP%'
          OR COALESCE(j.meta->>'cancel_reason', j.last_error,'') ILIKE '%REQUEUE_LOOP_KILLED%'
          OR COALESCE(j.meta->>'cancel_reason', j.last_error,'') ILIKE '%HOTLOOP_QUARANTINE%'
        )
      GROUP BY j.package_id, COALESCE(j.meta->>'step_key', regexp_replace(j.job_type,'^package_',''))
    )
    SELECT c.package_id, c.step_key, c.patterns, cp.status AS pkg_status, cp.title
    FROM classified c
    JOIN course_packages cp ON cp.id = c.package_id
    WHERE cp.status IN ('building','queued','blocked','quality_gate_failed','pending')
    ORDER BY cp.status, c.package_id, c.step_key
  LOOP
    v_started := clock_timestamp();

    SELECT count(*) INTO v_active
    FROM job_queue
    WHERE package_id = r.package_id
      AND (job_type = 'package_'||r.step_key OR meta->>'step_key' = r.step_key)
      AND status IN ('pending','queued','processing','running','batch_pending');

    IF v_active > 0 THEN
      v_skip_count := v_skip_count + 1;
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, input_params, result_status, result_detail, metadata)
      VALUES ('forensic_24h_heal', v_action, r.package_id::text, 'course_package',
              jsonb_build_object('step_key', r.step_key, 'patterns', r.patterns),
              'skipped', 'Pipeline-Jobs aktiv ('||v_active||')',
              jsonb_build_object('pkg_status', r.pkg_status, 'active_jobs', v_active, 'title', r.title));
      CONTINUE;
    END IF;

    IF r.pkg_status = 'blocked' THEN
      UPDATE course_packages
      SET status='building', blocked_reason=NULL, blocked_at=NULL, updated_at=now()
      WHERE id = r.package_id;
    END IF;

    BEGIN
      PERFORM admin_step_reset_detailed(
        p_package_id := r.package_id,
        p_step_keys  := ARRAY[r.step_key]::text[],
        p_reason     := 'forensic_24h_heal_2026_04_28: '||COALESCE(r.patterns,'unknown'),
        p_operator   := NULL,
        p_allow_regression := true,
        p_clear_exhaustion := true
      );
      -- Nudge atomic trigger to enqueue the job
      PERFORM admin_nudge_atomic_trigger(p_package_id := r.package_id, p_dry_run := false);

      v_heal_count := v_heal_count + 1;
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, input_params, result_status, result_detail, duration_ms, metadata)
      VALUES ('forensic_24h_heal', v_action, r.package_id::text, 'course_package',
              jsonb_build_object('step_key', r.step_key, 'patterns', r.patterns),
              'success', 'Step reset & atomic nudged',
              EXTRACT(MILLISECOND FROM clock_timestamp()-v_started)::int,
              jsonb_build_object('pkg_status_was', r.pkg_status, 'title', r.title));
    EXCEPTION WHEN OTHERS THEN
      v_fail_count := v_fail_count + 1;
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, input_params, result_status, result_detail, error_message, metadata)
      VALUES ('forensic_24h_heal', v_action, r.package_id::text, 'course_package',
              jsonb_build_object('step_key', r.step_key, 'patterns', r.patterns),
              'failed', 'RPC error', SQLERRM,
              jsonb_build_object('sqlstate', SQLSTATE, 'pkg_status', r.pkg_status, 'title', r.title));
    END;
  END LOOP;

  -- Reap stale running/processing jobs (>2h, no heartbeat)
  UPDATE job_queue
  SET status='cancelled', completed_at=now(), updated_at=now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'cancel_reason', 'FORENSIC_24H_HEAL: stale runner (>2h, no heartbeat)',
        'forensic_heal_at', to_jsonb(now())
      )
  WHERE status IN ('running','processing')
    AND COALESCE(last_heartbeat_at, started_at, updated_at) < now() - interval '2 hours';

  RAISE NOTICE 'FORENSIC_24H_HEAL_V3: healed=%, skipped=%, failed=%', v_heal_count, v_skip_count, v_fail_count;
END $$;