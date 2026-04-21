
-- P0a: Stale Locks freigeben
DO $$
DECLARE
  v_released int := 0;
  v_dead_workers text[] := ARRAY[
    'job-runner-03b8e5c1','job-runner-eea0db90','job-runner-782edfc8','job-runner-bec14575'
  ];
  v_stuck_jobs uuid[] := ARRAY[
    '88aea869-def4-4b2d-9811-61b0a5d9c648'::uuid,
    '1640ef1b-a7a3-459d-bdfd-0a03ba7230c9'::uuid,
    '18143d60-6c11-4169-92e6-671796e34ab4'::uuid,
    '4f84bfd2-613b-4a82-ab33-555a6921900e'::uuid,
    'f2c6407d-3387-4602-9b59-c6abd43a34c3'::uuid,
    '2e7e97eb-efe9-4192-b669-5bbaa44eca7a'::uuid,
    '49bfd7a8-593d-49a9-a8de-4538e4131214'::uuid
  ];
BEGIN
  UPDATE job_queue
  SET status='pending', locked_by=NULL, locked_at=NULL, started_at=NULL,
      run_after = now() + interval '30 seconds',
      last_error = COALESCE(last_error,'') || ' | stale_lock_force_released',
      updated_at = now()
  WHERE id = ANY(v_stuck_jobs)
    AND status='processing'
    AND (locked_by = ANY(v_dead_workers) OR locked_by IS NULL);
  GET DIAGNOSTICS v_released = ROW_COUNT;

  INSERT INTO admin_actions (action, scope, payload, affected_ids)
  VALUES ('stale_lock_force_release','pipeline.queue.dead_worker_recovery',
    jsonb_build_object('released_count',v_released,'dead_workers',v_dead_workers,
      'reason','5 dead worker IDs holding locks; INTEGRITY_DEFERRED last_error confused stuck-scan'),
    v_stuck_jobs);
END $$;

-- P0b: Restaurant LF-Coverage Repair via Operator-Approval
-- (nutzt b0dbd616-9b93-47c8-83c5-39290130a6ea = Admin als approved_by)
DO $$
DECLARE
  v_pkg_id uuid := '03287d1e-a4eb-4188-b65f-82eebf66dc82';
  v_curr_id uuid;
  v_approved int;
  v_admin uuid := 'b0dbd616-9b93-47c8-83c5-39290130a6ea';
BEGIN
  SELECT curriculum_id INTO v_curr_id FROM course_packages WHERE id = v_pkg_id;

  UPDATE question_blueprints qb
  SET status = 'approved'::blueprint_status,
      approved_at = now(),
      approved_by = v_admin,
      updated_at = now()
  FROM learning_fields lf
  WHERE qb.learning_field_id = lf.id
    AND lf.curriculum_id = v_curr_id
    AND lf.title IN (
      'Prüfungsvorbereitung und Berufswegplanung',
      'Interkulturelle Kompetenz und Nachhaltigkeit'
    )
    AND qb.status::text <> 'approved';
  GET DIAGNOSTICS v_approved = ROW_COUNT;

  INSERT INTO admin_actions (action, scope, payload, affected_ids, user_id)
  VALUES ('restaurant_lf_coverage_repair','pipeline.exam_pool.lf_coverage',
    jsonb_build_object('package_id',v_pkg_id,'approved_count',v_approved,
      'target_lfs',ARRAY['Prüfungsvorbereitung und Berufswegplanung','Interkulturelle Kompetenz und Nachhaltigkeit'],
      'reason','operator-approved repair: 0 approved BPs in 2 LFs caused validate_exam_pool QG FAIL loop 16/25'),
    ARRAY[v_pkg_id], v_admin);
END $$;
