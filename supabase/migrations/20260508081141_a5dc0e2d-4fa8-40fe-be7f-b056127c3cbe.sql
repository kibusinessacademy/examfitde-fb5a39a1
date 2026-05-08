-- Replay finalize for 38 stuck packages, inline (bypasses RPC permission check; runs as migration role).
DO $$
DECLARE
  r record;
  v_pkg record;
  v_step_id uuid;
  v_job_id uuid;
  v_idem text;
BEGIN
  FOR r IN
    SELECT DISTINCT ON ((metadata->>'package_id')::uuid)
           (metadata->>'package_id')::uuid AS pkg,
           metadata->'summary' AS summary
    FROM auto_heal_log
    WHERE action_type='bronze_repair_finalized'
      AND created_at > now() - interval '6 hours'
      AND (metadata->>'integrity_job_id' IS NULL OR metadata->>'integrity_job_id'='')
    ORDER BY (metadata->>'package_id')::uuid, created_at DESC
  LOOP
    SELECT * INTO v_pkg FROM course_packages WHERE id = r.pkg FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    UPDATE course_packages
       SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'::jsonb),'{bronze}',
             COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
               'repair_active', false,
               'last_repair_completed_at', now(),
               'last_repair_summary', COALESCE(r.summary,'{}'::jsonb),
               'replayed_via','migration_2026_05_08'), true)
     WHERE id = r.pkg;

    UPDATE package_steps
       SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
             'allow_regression', true,
             'allow_regression_by','repair_rpc',
             'reset_by','migration_replay_finalize',
             'reset_at', now(),
             'reset_reason','bronze_targeted_repair_completed')
     WHERE package_id = r.pkg AND step_key = 'run_integrity_check';

    UPDATE package_steps
       SET status='queued', updated_at=now(), started_at=NULL, finished_at=NULL, last_error=NULL
     WHERE package_id = r.pkg AND step_key = 'run_integrity_check'
     RETURNING id INTO v_step_id;

    v_idem := 'bronze_repair_integrity:v3:replay:' || r.pkg::text;
    BEGIN
      INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, idempotency_key)
      VALUES (
        'package_run_integrity_check', r.pkg, 'pending', 6,
        jsonb_build_object(
          'package_id', r.pkg,
          'curriculum_id', v_pkg.curriculum_id,
          '_origin','bronze_targeted_repair',
          'mode','bronze_targeted_repair',
          'enqueue_source','bronze_targeted_repair',
          'bronze_lock_override', true),
        jsonb_build_object('bronze_repair_followup', true,
          'enqueue_source','bronze_targeted_repair',
          'bronze_lock_override', true,
          'replayed_via','migration_2026_05_08'),
        v_idem)
      RETURNING id INTO v_job_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_job_id FROM job_queue WHERE idempotency_key = v_idem LIMIT 1;
    END;

    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('migration_replay_finalize_2026_05_08','bronze_repair_finalized',
            r.pkg::text,'package','success',
            format('Replay: integrity job %s', v_job_id),
            jsonb_build_object('package_id', r.pkg,'integrity_job_id', v_job_id,
              'step_id', v_step_id,'summary', COALESCE(r.summary,'{}'::jsonb), 'replay', true));
  END LOOP;
END $$;