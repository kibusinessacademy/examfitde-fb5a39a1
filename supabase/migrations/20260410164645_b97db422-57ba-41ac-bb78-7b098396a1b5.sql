
DO $$
DECLARE
  rec RECORD;
  healed INT := 0;
BEGIN
  FOR rec IN
    SELECT DISTINCT ps.package_id, ps.step_key
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'
      AND cp.status = 'building'
      AND EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.status = 'completed'
          AND jq.result->>'ok' = 'true'
          AND jq.job_type = 'package_' || ps.step_key
          AND jq.updated_at >= NOW() - INTERVAL '24 hours'
      )
  LOOP
    UPDATE package_steps
    SET status = 'done', updated_at = NOW()
    WHERE package_id = rec.package_id
      AND step_key = rec.step_key
      AND status = 'queued';
    healed := healed + 1;
  END LOOP;

  INSERT INTO auto_heal_log (trigger_source, action_type, target_type, result_status, result_detail)
  VALUES ('admin_migration', 'ghost_step_sync_heal', 'package_steps', 'success', 
    jsonb_build_object('healed_count', healed));
END $$;
