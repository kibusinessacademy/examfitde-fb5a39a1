UPDATE course_packages SET status='building', updated_at=now()
WHERE id IN ('0b98da0b-00e0-417a-8070-1260eb4f5c35','396567e6-6c3f-44d4-8088-6fef52b14629','beb241ed-58dc-4ddc-930d-ca041dbde99f','060fa7ef-f9b9-4b5e-8590-de8f667ee34d','04634848-89a3-4726-af1f-2f04aa4eacf7','90839124-4e95-41f7-99b2-6c7b5a9a5b80','1a2aac1c-2505-46c7-beb1-fd9d20fca95d','8f43899c-8081-49f5-a3c7-3710d49e1986','65c74607-9f65-4b21-8fb9-a8c7f3aa3d92','8e969f78-f50e-4b01-8a7b-630cb705bf96');

UPDATE package_steps SET status='pending_enqueue', updated_at=now()
WHERE step_key='auto_publish' AND package_id IN ('0b98da0b-00e0-417a-8070-1260eb4f5c35','396567e6-6c3f-44d4-8088-6fef52b14629','beb241ed-58dc-4ddc-930d-ca041dbde99f');

UPDATE package_steps SET status='pending_enqueue', updated_at=now()
WHERE step_key='run_integrity_check' AND package_id IN ('060fa7ef-f9b9-4b5e-8590-de8f667ee34d','04634848-89a3-4726-af1f-2f04aa4eacf7');

UPDATE package_steps SET status='pending_enqueue', updated_at=now()
WHERE step_key='generate_exam_pool' AND package_id IN ('90839124-4e95-41f7-99b2-6c7b5a9a5b80','1a2aac1c-2505-46c7-beb1-fd9d20fca95d','8f43899c-8081-49f5-a3c7-3710d49e1986','65c74607-9f65-4b21-8fb9-a8c7f3aa3d92','8e969f78-f50e-4b01-8a7b-630cb705bf96');

INSERT INTO job_queue (job_type, package_id, status, payload, priority, meta)
SELECT t.job_type, t.pkg_id::uuid, 'pending',
  jsonb_build_object('package_id', t.pkg_id, 'curriculum_id', t.cur_id, 'source', 'manual_heal_v6'),
  t.prio,
  jsonb_build_object('source','manual_heal_v6','allow_regression',true)
FROM (VALUES
  ('package_auto_publish','0b98da0b-00e0-417a-8070-1260eb4f5c35','b4e27ea8-477b-4eba-a510-d7025e91b736',5),
  ('package_auto_publish','396567e6-6c3f-44d4-8088-6fef52b14629','941697ed-2480-4f89-8c2c-4e79e9c8cfb2',5),
  ('package_auto_publish','beb241ed-58dc-4ddc-930d-ca041dbde99f','7d72d436-db9b-4b22-bda8-fd7c764ae7eb',5),
  ('package_run_integrity_check','060fa7ef-f9b9-4b5e-8590-de8f667ee34d','8620adb3-b494-4ee8-95fb-b9f836c8f2db',6),
  ('package_run_integrity_check','04634848-89a3-4726-af1f-2f04aa4eacf7','c56feae3-d4c5-4e4f-bf84-f024d9fb2f37',6),
  ('package_generate_exam_pool','90839124-4e95-41f7-99b2-6c7b5a9a5b80','04744aeb-8762-49f7-b6a7-6dcf3013225e',7),
  ('package_generate_exam_pool','1a2aac1c-2505-46c7-beb1-fd9d20fca95d','859a4523-b18c-4048-ab55-c39a43af7852',7),
  ('package_generate_exam_pool','8f43899c-8081-49f5-a3c7-3710d49e1986','847489bb-0070-4971-a536-38d53e030d23',7),
  ('package_generate_exam_pool','65c74607-9f65-4b21-8fb9-a8c7f3aa3d92','94fa4d27-73a9-4bfe-9f24-7d450705639f',7),
  ('package_generate_exam_pool','8e969f78-f50e-4b01-8a7b-630cb705bf96','ae48e7f1-e5ab-4479-85c3-bb2e6e816674',7)
) AS t(job_type, pkg_id, cur_id, prio);

INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, input_params, result_status, metadata)
SELECT 'manual_lovable_agent','manual_bypass_v6', pkg_id::uuid, 'package',
  jsonb_build_object('group',grp,'enqueued',job), 'success',
  jsonb_build_object('group',grp,'job_type',job)
FROM (VALUES
  ('0b98da0b-00e0-417a-8070-1260eb4f5c35','A_release_ok','package_auto_publish'),
  ('396567e6-6c3f-44d4-8088-6fef52b14629','A_release_ok','package_auto_publish'),
  ('beb241ed-58dc-4ddc-930d-ca041dbde99f','A_release_ok','package_auto_publish'),
  ('060fa7ef-f9b9-4b5e-8590-de8f667ee34d','B_integrity_stale','package_run_integrity_check'),
  ('04634848-89a3-4726-af1f-2f04aa4eacf7','B_integrity_stale','package_run_integrity_check'),
  ('90839124-4e95-41f7-99b2-6c7b5a9a5b80','C_content_gap','package_generate_exam_pool'),
  ('1a2aac1c-2505-46c7-beb1-fd9d20fca95d','C_content_gap','package_generate_exam_pool'),
  ('8f43899c-8081-49f5-a3c7-3710d49e1986','C_content_gap','package_generate_exam_pool'),
  ('65c74607-9f65-4b21-8fb9-a8c7f3aa3d92','C_content_gap','package_generate_exam_pool'),
  ('8e969f78-f50e-4b01-8a7b-630cb705bf96','C_content_gap','package_generate_exam_pool')
) AS t(pkg_id, grp, job);
