DO $$
DECLARE
  v_pkg_id uuid;
  v_result jsonb;
  v_count_ok int := 0;
  v_count_fail int := 0;
  v_run_id uuid := gen_random_uuid();
  
  c_pub CURSOR FOR
    SELECT cp.id FROM course_packages cp
    JOIN v_package_release_classification rc ON rc.package_id = cp.id
    WHERE rc.council_approved = true
      AND rc.release_class IN ('release_ok','release_warn')
      AND cp.status NOT IN ('published','archived')
      AND cp.product_id IS NOT NULL;
BEGIN
  OPEN c_pub;
  LOOP
    FETCH c_pub INTO v_pkg_id;
    EXIT WHEN NOT FOUND;
    
    BEGIN
      v_result := public.publish_package_version(v_pkg_id);
      v_count_ok := v_count_ok + 1;
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('manual_bulk_heal_2026_04_29_v5', 'manual_bypass_publish', v_pkg_id, 'course_package',
        'success', v_result, jsonb_build_object('run_id', v_run_id, 'attempt', 'post_coverage_repair'));
    EXCEPTION WHEN OTHERS THEN
      v_count_fail := v_count_fail + 1;
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, error_message, metadata)
      VALUES ('manual_bulk_heal_2026_04_29_v5', 'manual_bypass_publish', v_pkg_id, 'course_package',
        'error', SQLERRM, jsonb_build_object('run_id', v_run_id, 'attempt', 'post_coverage_repair'));
    END;
  END LOOP;
  CLOSE c_pub;
  
  RAISE NOTICE 'v5 Final Publish: ok=%, fail=%, run_id=%', v_count_ok, v_count_fail, v_run_id;
END $$;