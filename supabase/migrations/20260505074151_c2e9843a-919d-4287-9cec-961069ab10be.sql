SET session_replication_role = 'replica';
DO $$
DECLARE
  r RECORD;
  v_updated int;
BEGIN
  FOR r IN
    SELECT target_id::uuid AS pid, metadata->>'step_key' AS skey, COUNT(*) AS heals
    FROM auto_heal_log
    WHERE created_at > now() - interval '24 hours'
      AND action_type = 'pipeline_step_drift_v3_heal'
      AND result_status = 'success'
    GROUP BY 1,2
    HAVING COUNT(*) > 20
  LOOP
    UPDATE package_steps
       SET status = 'failed'::step_status,
           last_error = 'manual_bypass: drift_v3_loop >' || r.heals || ' reheals/24h — operator review',
           updated_at = now()
     WHERE package_id = r.pid AND step_key::text = r.skey
       AND status IN ('queued','pending_enqueue');
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES ('manual_bypass_drift_loop','package', r.pid::text, 'success',
              jsonb_build_object('step_key', r.skey, 'reheals_24h', r.heals, 'operator','migration','bypass','session_replication_role'));
    END IF;
  END LOOP;
END $$;
SET session_replication_role = 'origin';