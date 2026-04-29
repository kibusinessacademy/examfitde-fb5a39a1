DO $$
DECLARE
  v_pkg_id uuid;
  v_curr_id uuid;
  v_result jsonb;
  v_count_published int := 0;
  v_count_council_enqueued int := 0;
  v_count_failed int := 0;
  v_approved_q int;
  v_release_class text;
  v_run_id uuid := gen_random_uuid();
  
  c_publish CURSOR FOR
    SELECT cp.id, cp.curriculum_id, rc.approved_questions, rc.release_class
    FROM course_packages cp
    JOIN v_package_release_classification rc ON rc.package_id = cp.id
    WHERE rc.council_approved = true
      AND rc.release_class IN ('release_ok','release_warn')
      AND cp.status NOT IN ('published','archived')
      AND cp.product_id IS NOT NULL;
  
  c_council CURSOR FOR
    SELECT cp.id, cp.curriculum_id, rc.approved_questions
    FROM course_packages cp
    JOIN v_package_release_classification rc ON rc.package_id = cp.id
    WHERE rc.release_class = 'release_ok' 
      AND rc.council_approved = false
      AND cp.status IN ('queued','building')
      AND cp.curriculum_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq 
        WHERE jq.package_id = cp.id 
          AND jq.job_type = 'package_quality_council'
          AND jq.status IN ('pending','processing')
      )
    ORDER BY rc.approved_questions DESC;

BEGIN
  -- 1) DIRECT PUBLISH
  OPEN c_publish;
  LOOP
    FETCH c_publish INTO v_pkg_id, v_curr_id, v_approved_q, v_release_class;
    EXIT WHEN NOT FOUND;
    
    BEGIN
      v_result := public.publish_package_version(v_pkg_id);
      v_count_published := v_count_published + 1;
      
      INSERT INTO auto_heal_log (
        trigger_source, action_type, target_id, target_type, 
        input_params, result_status, result_detail, metadata
      ) VALUES (
        'manual_bulk_heal_2026_04_29', 'manual_bypass_publish', v_pkg_id, 'course_package',
        jsonb_build_object('approved_questions', v_approved_q, 'release_class', v_release_class),
        'success', v_result,
        jsonb_build_object('run_id', v_run_id, 'reason', 'council_approved + release_ok/warn')
      );
    EXCEPTION WHEN OTHERS THEN
      v_count_failed := v_count_failed + 1;
      INSERT INTO auto_heal_log (
        trigger_source, action_type, target_id, target_type,
        input_params, result_status, error_message, metadata
      ) VALUES (
        'manual_bulk_heal_2026_04_29', 'manual_bypass_publish', v_pkg_id, 'course_package',
        jsonb_build_object('approved_questions', v_approved_q, 'release_class', v_release_class),
        'error', SQLERRM,
        jsonb_build_object('run_id', v_run_id)
      );
    END;
  END LOOP;
  CLOSE c_publish;
  
  -- 2) COUNCIL-ENQUEUE (mit curriculum_id im Payload)
  OPEN c_council;
  LOOP
    FETCH c_council INTO v_pkg_id, v_curr_id, v_approved_q;
    EXIT WHEN NOT FOUND;
    
    BEGIN
      INSERT INTO job_queue (
        job_type, status, package_id, payload, priority, run_after, lane, worker_pool
      ) VALUES (
        'package_quality_council', 'pending', v_pkg_id, 
        jsonb_build_object(
          'package_id', v_pkg_id, 
          'curriculum_id', v_curr_id,
          'source', 'manual_bulk_heal'
        ),
        90, now(), 'control', 'control'
      );
      v_count_council_enqueued := v_count_council_enqueued + 1;
      
      INSERT INTO auto_heal_log (
        trigger_source, action_type, target_id, target_type,
        input_params, result_status, metadata
      ) VALUES (
        'manual_bulk_heal_2026_04_29', 'manual_council_enqueue', v_pkg_id, 'course_package',
        jsonb_build_object('approved_questions', v_approved_q, 'curriculum_id', v_curr_id),
        'success', 
        jsonb_build_object('run_id', v_run_id, 'reason', 'release_ok ohne Council-Verdikt')
      );
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log (
        trigger_source, action_type, target_id, target_type,
        input_params, result_status, error_message, metadata
      ) VALUES (
        'manual_bulk_heal_2026_04_29', 'manual_council_enqueue', v_pkg_id, 'course_package',
        jsonb_build_object('approved_questions', v_approved_q, 'curriculum_id', v_curr_id),
        'error', SQLERRM,
        jsonb_build_object('run_id', v_run_id)
      );
    END;
  END LOOP;
  CLOSE c_council;
  
  RAISE NOTICE 'Bulk-Heal: published=%, failed=%, council_enqueued=%, run_id=%', 
    v_count_published, v_count_failed, v_count_council_enqueued, v_run_id;
END $$;

INSERT INTO auto_heal_log (
  trigger_source, action_type, target_type, result_status, metadata
) VALUES (
  'manual_bulk_heal_2026_04_29', 'bulk_heal_summary', 'course_package', 'completed',
  jsonb_build_object(
    'published_count', (SELECT COUNT(*) FROM auto_heal_log WHERE trigger_source='manual_bulk_heal_2026_04_29' AND action_type='manual_bypass_publish' AND result_status='success'),
    'failed_count', (SELECT COUNT(*) FROM auto_heal_log WHERE trigger_source='manual_bulk_heal_2026_04_29' AND action_type='manual_bypass_publish' AND result_status='error'),
    'council_enqueued_count', (SELECT COUNT(*) FROM auto_heal_log WHERE trigger_source='manual_bulk_heal_2026_04_29' AND action_type='manual_council_enqueue' AND result_status='success')
  )
);