DO $$
DECLARE
  r record; v jsonb;
  v_council_dispatched int := 0;
  v_council_skipped int := 0;
  v_publish_acked int := 0;
  v_active_acked int := 0;
BEGIN
  -- ── Bucket A1: Bronze quality_council failed steps → dispatch repair ──
  FOR r IN
    SELECT DISTINCT cp.id AS package_id
    FROM course_packages cp
    JOIN package_steps ps ON ps.package_id=cp.id AND ps.step_key='quality_council' AND ps.status='failed'
    WHERE cp.id IN (
      SELECT DISTINCT package_id FROM job_queue
       WHERE status='failed' AND updated_at > now() - interval '24 hours'
         AND job_type='package_quality_council'
         AND (last_error LIKE '%PRE_HEARTBEAT_KILL%' OR last_error LIKE '%MAX_ATTEMPTS%' OR last_error LIKE '%STALE_LOCK%')
    )
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
       WHERE jq.package_id=cp.id AND jq.job_type='package_quality_council'
         AND jq.status IN ('pending','processing')
    )
    AND ps.meta->>'badge'='bronze'
  LOOP
    BEGIN
      v := public.admin_bronze_targeted_repair_dispatch(r.package_id);
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('migration:failed_cluster_24h_heal_2026_05_09','failed_cluster_24h_heal',
              r.package_id::text,'package','success',
              'bronze_council_repair_dispatch: '||v::text,
              jsonb_build_object('bucket','A1_council_bronze','dispatch', v));
      v_council_dispatched := v_council_dispatched + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, error_message, metadata)
      VALUES ('migration:failed_cluster_24h_heal_2026_05_09','failed_cluster_24h_heal',
              r.package_id::text,'package','error', SQLERRM,
              jsonb_build_object('bucket','A1_council_bronze'));
      v_council_skipped := v_council_skipped + 1;
    END;
  END LOOP;

  -- ── Bucket A2: Bronze auto_publish failed → terminal ack (no requeue) ──
  FOR r IN
    SELECT DISTINCT cp.id AS package_id
    FROM course_packages cp
    JOIN package_steps ps ON ps.package_id=cp.id AND ps.step_key='auto_publish' AND ps.status='failed'
    WHERE cp.id IN (
      SELECT DISTINCT package_id FROM job_queue
       WHERE status='failed' AND updated_at > now() - interval '24 hours'
         AND job_type='package_auto_publish'
         AND (last_error LIKE '%PRE_HEARTBEAT_KILL%' OR last_error LIKE '%MAX_ATTEMPTS%' OR last_error LIKE '%STALE_LOCK%' OR last_error LIKE '%REQUEUE_LOOP%')
    )
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
       WHERE jq.package_id=cp.id AND jq.job_type='package_auto_publish'
         AND jq.status IN ('pending','processing')
    )
    AND COALESCE((cp.feature_flags->'bronze'->>'manual_bypass')::boolean,false) = true
  LOOP
    UPDATE package_steps
       SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
             'terminal_acknowledged_at', now(),
             'terminal_acknowledged_by','manual_failed_cluster_heal_2026_05_09',
             'terminal_reason','bronze_locked_no_auto_publish'),
           updated_at = now()
     WHERE package_id=r.package_id AND step_key='auto_publish';

    UPDATE course_packages
       SET feature_flags = jsonb_set(
             COALESCE(feature_flags,'{}'::jsonb),'{bronze}',
             COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
               'requires_review', true,
               'final_state','requires_review',
               'final_state_at', now()), true)
     WHERE id = r.package_id;

    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('migration:failed_cluster_24h_heal_2026_05_09','failed_cluster_24h_heal',
            r.package_id::text,'package','success',
            'auto_publish step terminal acknowledged (bronze final)',
            jsonb_build_object('bucket','A2_auto_publish_bronze_final'));
    v_publish_acked := v_publish_acked + 1;
  END LOOP;

  -- ── Bucket B: Active jobs already running — audit ack only ──
  FOR r IN
    SELECT DISTINCT package_id, job_type
      FROM job_queue
     WHERE status='failed' AND updated_at > now() - interval '24 hours'
       AND (last_error LIKE '%PRE_HEARTBEAT_KILL%' OR last_error LIKE '%MAX_ATTEMPTS%' OR last_error LIKE '%STALE_LOCK%')
       AND EXISTS (
         SELECT 1 FROM job_queue jq2
          WHERE jq2.package_id=job_queue.package_id AND jq2.job_type=job_queue.job_type
            AND jq2.status IN ('pending','processing')
       )
  LOOP
    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('migration:failed_cluster_24h_heal_2026_05_09','failed_cluster_24h_heal',
            r.package_id::text,'package','success',
            'self_heal_active_no_action',
            jsonb_build_object('bucket','B_active_self_heal','job_type', r.job_type));
    v_active_acked := v_active_acked + 1;
  END LOOP;

  -- ── Final summary row ──
  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('migration:failed_cluster_24h_heal_2026_05_09','failed_cluster_24h_heal_summary',
          'system','system','success',
          format('council_dispatched=%s council_errors=%s publish_acked=%s active_acked=%s',
                 v_council_dispatched, v_council_skipped, v_publish_acked, v_active_acked),
          jsonb_build_object(
            'council_dispatched', v_council_dispatched,
            'council_errors', v_council_skipped,
            'publish_acked', v_publish_acked,
            'active_acked', v_active_acked,
            'ran_at', now()));
END $$;