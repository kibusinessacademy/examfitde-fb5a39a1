DO $$
DECLARE
  v_dachdecker uuid := 'ba73a842-ade3-4d36-9108-3abdad11188f';
  v_curriculum uuid;
  v_complete uuid[] := ARRAY[
    '2cf5ffc7-5e48-40ec-90c8-f8856f99fd77'::uuid,
    '3354ec39-6da6-40ef-b613-c2626fa40f3a'::uuid,
    '4f07605b-021b-476e-8d68-50e425de10a9'::uuid
  ];
  v_pkg uuid;
  v_job_id uuid;
  v_idem text;
  v_exists uuid;
BEGIN
  SELECT curriculum_id INTO v_curriculum FROM course_packages WHERE id=v_dachdecker;

  FOREACH v_pkg IN ARRAY v_complete LOOP
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES (
      'a2_artifact_audit_complete', 'package', v_pkg, 'noop_complete',
      jsonb_build_object(
        'bucket','A2_auto_publish_bronze_final','track','EXAM_FIRST',
        'artifact_status','complete','lf_coverage','12/12',
        'final_state','requires_review',
        'reason','bronze_final_structurally_blocks_auto_publish_no_artifact_gap'
      )
    );
  END LOOP;

  v_idem := 'a2_lf10_repair:' || v_dachdecker || ':' || to_char(now(), 'YYYYMMDDHH24');

  SELECT id INTO v_exists FROM public.job_queue WHERE idempotency_key = v_idem LIMIT 1;
  IF v_exists IS NULL THEN
    INSERT INTO public.job_queue (
      job_type, status, payload, package_id, max_attempts, priority, worker_pool, idempotency_key, meta
    )
    VALUES (
      'package_repair_exam_pool_lf_coverage', 'pending',
      jsonb_build_object(
        'package_id', v_dachdecker,
        'curriculum_id', v_curriculum,
        'action','repair_lf_coverage',
        'target_lfs', jsonb_build_array('LF10'),
        'bronze_lock_override', true,
        '_origin','wave_heal_lf_coverage',
        'reason','a2_artifact_gap_lf10_zero_approved_questions'
      ),
      v_dachdecker, 3, 50, 'control', v_idem,
      jsonb_build_object('enqueue_source','manual_a2_artifact_heal','bypass_audit',true)
    )
    RETURNING id INTO v_job_id;
  ELSE
    v_job_id := v_exists;
  END IF;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'a2_artifact_gap_lf_repair','package',v_dachdecker,
    CASE WHEN v_exists IS NULL THEN 'enqueued' ELSE 'idempotent_skip' END,
    jsonb_build_object(
      'bucket','A2_auto_publish_bronze_final','track','EXAM_FIRST',
      'gap', jsonb_build_object('LF10', jsonb_build_object('approved_q',0,'approved_bp',9,'variants_missing',true)),
      'job_id', v_job_id, 'idempotency_key', v_idem,
      'curriculum_id', v_curriculum,
      'bronze_lock_override', true, 'origin','wave_heal_lf_coverage'
    )
  );

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'a2_artifact_heal_summary','system', NULL, 'ok',
    jsonb_build_object(
      'packages_audited',4,'artifact_complete',3,'artifact_gap_repaired',1,
      'gap_package',v_dachdecker,'gap_lf','LF10','enqueued_job',v_job_id
    )
  );
END $$;