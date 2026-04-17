
DO $$
DECLARE
  v_user uuid := 'b0dbd616-9b93-47c8-83c5-39290130a6ea';
  v_generate_ids uuid[] := ARRAY[
    '04634848-89a3-4726-af1f-2f04aa4eacf7','051ba572-6027-412d-a700-975d2cb2ec4a','060fa7ef-f9b9-4b5e-8590-de8f667ee34d',
    '061bce96-286e-4f61-93be-699636d75a7d','06516437-8b44-41e4-bc50-67e01e26897d','0b302f99-e515-4a6c-819e-3a65ba326e8c',
    '0b98da0b-00e0-417a-8070-1260eb4f5c35','01cf48b2-fa6c-4e38-98ed-8d571aae63c4','0d0dcc1d-ae63-4a48-975e-04e53241cee1',
    '0e488d83-0fa7-4a2f-8c0e-82516e024b4f','21f0b991-17ef-49a7-96fb-71e076a74e7d','d1336c74-952a-4b06-8f4d-2fb826346b77',
    'd2000000-0011-4000-8000-000000000001','015e3cc4-b9c4-42f1-926d-346f3844030a','045aca72-11a9-4447-8b9f-0a92ef662fda',
    '0ca8bb46-b410-423b-9b75-4f0fe7e85dbe','022eb5fc-281a-4764-928f-a3c77a6f8997','026c9f18-210f-45a0-93ae-cd4f348a067e',
    '0330e463-2dd3-44ff-a86f-2b0e051e3203','0455666c-52dc-423a-9957-a81f669705ae'
  ]::uuid[];
  v_repair_ids uuid[] := ARRAY[
    '03287d1e-a4eb-4188-b65f-82eebf66dc82','d2000000-0001-4000-8000-000000000001',
    '398573ab-bc9d-4fc9-9d8e-3607c24f3bf9','d2000002-0003-4000-8000-000000000001',
    '8acce74a-4f16-4589-a9b3-1b3c37961404'
  ]::uuid[];
  v_id uuid; v_curriculum uuid; v_jobs_queued int := 0;
BEGIN
  FOREACH v_id IN ARRAY v_generate_ids LOOP
    SELECT curriculum_id INTO v_curriculum FROM course_packages WHERE id = v_id;
    IF NOT EXISTS (SELECT 1 FROM job_queue WHERE package_id = v_id 
                   AND job_type = 'package_generate_exam_pool' AND status IN ('pending','processing')) THEN
      INSERT INTO job_queue (job_type, package_id, status, payload, priority, created_at)
      VALUES ('package_generate_exam_pool', v_id, 'pending',
        jsonb_build_object('source','heal_wave_v8.6.2','reason','blocked_no_content',
                           'curriculum_id', v_curriculum, 'package_id', v_id), 8, now());
      v_jobs_queued := v_jobs_queued + 1;
    END IF;
  END LOOP;

  FOREACH v_id IN ARRAY v_repair_ids LOOP
    SELECT curriculum_id INTO v_curriculum FROM course_packages WHERE id = v_id;
    IF NOT EXISTS (SELECT 1 FROM job_queue WHERE package_id = v_id 
                   AND job_type = 'package_repair_exam_pool_quality' AND status IN ('pending','processing')) THEN
      INSERT INTO job_queue (job_type, package_id, status, payload, priority, created_at)
      VALUES ('package_repair_exam_pool_quality', v_id, 'pending',
        jsonb_build_object('source','heal_wave_v8.6.2','reason','blocked_partial_content',
                           'curriculum_id', v_curriculum, 'package_id', v_id), 8, now());
      v_jobs_queued := v_jobs_queued + 1;
    END IF;
  END LOOP;

  -- SSOT-konformer reason: awaiting_source_data (Pool wird gerade generiert)
  UPDATE course_packages
  SET blocked_reason = 'awaiting_source_data',
      last_error = 'heal_v8.6.2: job queued, awaiting WIP slot',
      updated_at = now()
  WHERE id = ANY(v_generate_ids || v_repair_ids)
    AND status = 'blocked'
    AND blocked_reason = 'pipeline_repair_required';

  INSERT INTO admin_actions (action, scope, affected_ids, payload, user_id)
  VALUES ('heal_wave_v8.6.2_jobs_queued', 'pipeline_recovery',
    v_generate_ids || v_repair_ids,
    jsonb_build_object('jobs_queued', v_jobs_queued, 'wip_state', '25/25_at_heal_time',
                       'strategy', 'queue jobs, retag reason as awaiting_source_data'),
    v_user);
END $$;
