DO $$
DECLARE r record; v_result jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  FOR r IN
    SELECT cp.id, cp.title
    FROM course_packages cp
    WHERE (cp.feature_flags->'bronze'->>'requires_review') = 'true'
      AND cp.status = 'building'
      AND COALESCE((cp.feature_flags->'bronze'->>'repair_attempts')::int, 0) = 0
  LOOP
    BEGIN
      v_result := public.admin_bronze_targeted_repair_dispatch(r.id);
      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES('bronze_targeted_repair_bulk_dispatch','package',r.id::text,
             COALESCE(v_result->>'reason', CASE WHEN v_result ? 'job_id' THEN 'dispatched' ELSE 'noop' END),
             jsonb_build_object('trigger','user_payload_validate_lesson_minichecks_stale_reap_loop','title',r.title,'rpc_result',v_result));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES('bronze_targeted_repair_bulk_dispatch','package',r.id::text,'error',
             jsonb_build_object('error',SQLERRM,'title',r.title));
    END;
  END LOOP;
  RESET ROLE;
END$$;