
DO $mig$
DECLARE
  rlk_pkgs uuid[] := ARRAY[
    '6948f11f-3b19-4670-bf47-7e8688c15d20'::uuid,
    '461b6df4-832b-49a0-8d9d-d47e02b44d41'::uuid,
    'd89725ba-7bc9-4a6d-b72d-8119f7cd0ec4'::uuid,
    '7b19ae39-7aa7-4e9c-8bcb-04f690d1138b'::uuid,
    '1a2aac1c-2505-46c7-beb1-fd9d20fca95d'::uuid
  ];
  v_cancelled int := 0;
  v_steps_requeued int := 0;
  v_hb_enq int := 0;
  v_tut_enq int := 0;
  v_oral_enq int := 0;
BEGIN
  WITH c AS (
    UPDATE job_queue
    SET status='cancelled', completed_at=now(),
        last_error=COALESCE(last_error,'') || ' [TARGETED_HEAL: obsolete — oral blueprints exist + step=done]',
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('targeted_heal_cancelled_at', now(), 'reason','obsolete_rlk_oral_autoheal')
    WHERE status='failed' AND last_error ILIKE '%REQUEUE_LOOP_KILLED%'
      AND payload->>'_origin' = 'oral_autoheal_v1'
      AND package_id = ANY(rlk_pkgs)
    RETURNING 1
  ) SELECT COUNT(*) INTO v_cancelled FROM c;

  WITH r AS (
    UPDATE package_steps
    SET status='queued',
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('targeted_heal_requeued_at', now(), '_origin','targeted_deficiency_heal_v1'),
        updated_at=now()
    WHERE package_id = ANY(rlk_pkgs)
      AND step_key IN ('elite_harden','run_integrity_check','quality_council','auto_publish')
      AND status::text IN ('skipped','blocked')
    RETURNING 1
  ) SELECT COUNT(*) INTO v_steps_requeued FROM r;

  WITH ins AS (
    INSERT INTO job_queue (job_type, payload, status, max_attempts, priority, package_id, lane, worker_pool, idempotency_key, meta)
    SELECT 'package_generate_handbook',
      jsonb_build_object('package_id', cp.id, 'curriculum_id', cp.curriculum_id, '_origin','targeted_deficiency_heal_v1'),
      'pending', 3, 4, cp.id, 'content', 'default',
      'targeted_heal_handbook_v1:' || cp.id::text,
      jsonb_build_object('enqueue_source','targeted_deficiency_heal_v1','enqueued_at',now())
    FROM course_packages cp
    JOIN v_package_release_classification vc ON vc.package_id=cp.id
    WHERE cp.status='building' AND cp.curriculum_id IS NOT NULL AND vc.approved_questions >= 50
      AND NOT EXISTS (SELECT 1 FROM handbook_chapters hc WHERE hc.curriculum_id=cp.curriculum_id)
      AND NOT EXISTS (SELECT 1 FROM job_queue j WHERE j.package_id=cp.id AND j.job_type='package_generate_handbook' AND j.status IN ('pending','queued','processing'))
      AND COALESCE(cp.feature_flags->'bronze'->>'locked','false') <> 'true'
    RETURNING 1
  ) SELECT COUNT(*) INTO v_hb_enq FROM ins;

  UPDATE package_steps
  SET status='queued',
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('targeted_heal_requeued_at', now()),
      updated_at=now()
  WHERE step_key='generate_handbook' AND status::text IN ('skipped','blocked')
    AND package_id IN (
      SELECT package_id FROM job_queue
      WHERE job_type='package_generate_handbook'
        AND meta->>'enqueue_source'='targeted_deficiency_heal_v1'
        AND created_at > now() - interval '2 minutes'
    );

  WITH ins AS (
    INSERT INTO job_queue (job_type, payload, status, max_attempts, priority, package_id, lane, worker_pool, idempotency_key, meta)
    SELECT 'package_build_ai_tutor_index',
      jsonb_build_object('package_id', cp.id, 'curriculum_id', cp.curriculum_id, '_origin','targeted_deficiency_heal_v1'),
      'pending', 3, 5, cp.id, 'content', 'default',
      'targeted_heal_tutor_v1:' || cp.id::text,
      jsonb_build_object('enqueue_source','targeted_deficiency_heal_v1','enqueued_at',now())
    FROM course_packages cp
    WHERE cp.status='building' AND cp.curriculum_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ai_tutor_context_index ti WHERE ti.package_id=cp.id)
      AND NOT EXISTS (SELECT 1 FROM job_queue j WHERE j.package_id=cp.id AND j.job_type='package_build_ai_tutor_index' AND j.status IN ('pending','queued','processing'))
      AND COALESCE(cp.feature_flags->'bronze'->>'locked','false') <> 'true'
    RETURNING 1
  ) SELECT COUNT(*) INTO v_tut_enq FROM ins;

  WITH ins AS (
    INSERT INTO job_queue (job_type, payload, status, max_attempts, priority, package_id, lane, worker_pool, idempotency_key, meta)
    SELECT 'package_generate_oral_exam',
      jsonb_build_object('package_id', cp.id, 'curriculum_id', cp.curriculum_id, '_origin','targeted_deficiency_heal_v1'),
      'pending', 3, 5, cp.id, 'content', 'default',
      'targeted_heal_oral_v1:' || cp.id::text,
      jsonb_build_object('enqueue_source','targeted_deficiency_heal_v1','enqueued_at',now())
    FROM course_packages cp
    WHERE cp.status='building' AND cp.curriculum_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM oral_exam_blueprints o WHERE o.package_id=cp.id)
      AND NOT EXISTS (SELECT 1 FROM job_queue j WHERE j.package_id=cp.id AND j.job_type='package_generate_oral_exam' AND j.status IN ('pending','queued','processing'))
      AND COALESCE(cp.feature_flags->'bronze'->>'locked','false') <> 'true'
    RETURNING 1
  ) SELECT COUNT(*) INTO v_oral_enq FROM ins;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'targeted_deficiency_heal_v1', 'system', 'completed',
    jsonb_build_object(
      'rlk_jobs_cancelled', v_cancelled,
      'tail_steps_requeued', v_steps_requeued,
      'handbook_jobs_enqueued', v_hb_enq,
      'tutor_jobs_enqueued', v_tut_enq,
      'oral_jobs_enqueued', v_oral_enq,
      'rlk_packages', rlk_pkgs,
      'executed_at', now()
    )
  );

  RAISE NOTICE 'cancelled=%, tail=%, hb=%, tut=%, oral=%', v_cancelled, v_steps_requeued, v_hb_enq, v_tut_enq, v_oral_enq;
END $mig$;
