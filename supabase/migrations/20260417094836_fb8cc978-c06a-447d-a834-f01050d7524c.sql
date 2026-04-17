DO $$
DECLARE
  v_user uuid := 'b0dbd616-9b93-47c8-83c5-39290130a6ea';
BEGIN
  -- 1) TEXTILREINIGER: stale Job killen + Repair
  UPDATE job_queue
  SET status='cancelled',
      last_error = COALESCE(last_error,'') || ' | manual_kill_stale_v8.5',
      updated_at = now()
  WHERE package_id='01099a37-3309-4bc1-a2ce-6a6913e4d125'
    AND status='processing'
    AND job_type='package_generate_exam_pool';

  INSERT INTO job_queue (job_type, package_id, status, payload, created_at)
  VALUES (
    'package_repair_exam_pool_quality',
    '01099a37-3309-4bc1-a2ce-6a6913e4d125',
    'pending',
    jsonb_build_object('source','manual_heal_v8.5','curriculum_id','f8481368-984c-45b1-984a-3ecdc30ce467','package_id','01099a37-3309-4bc1-a2ce-6a6913e4d125'),
    now()
  );

  -- 2) SCRUM PSM I — Force Publish via SSOT
  PERFORM admin_force_steps_done(
    '65430b12-b481-46e0-88f4-c88606857da7'::uuid,
    NULL::text[],
    'manual_heal_v8.5: release_ok 1501 approved Q break unblock loop',
    true, true
  );

  -- 3) PRINCE2 — Force Publish via SSOT
  PERFORM admin_force_steps_done(
    'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'::uuid,
    NULL::text[],
    'manual_heal_v8.5: release_ok 605 approved Q break unblock loop',
    true, true
  );

  -- 4-6) Echte Content-Lücken: package_repair_exam_pool_quality
  INSERT INTO job_queue (job_type, package_id, status, payload, created_at)
  VALUES
  ('package_repair_exam_pool_quality','d2000000-0010-4000-8000-000000000001','pending',
    jsonb_build_object('source','manual_heal_v8.5','reason','2_of_4_lfs_empty','curriculum_id','d1000000-0010-4000-8000-000000000001','package_id','d2000000-0010-4000-8000-000000000001'), now()),
  ('package_repair_exam_pool_quality','dd000001-0005-4000-8000-000000000001','pending',
    jsonb_build_object('source','manual_heal_v8.5','reason','5_of_7_lfs_empty','curriculum_id','aa000001-0005-4000-8000-000000000001','package_id','dd000001-0005-4000-8000-000000000001'), now()),
  ('package_repair_exam_pool_quality','52cc076a-13ba-4f73-8202-b3f1164bba0f','pending',
    jsonb_build_object('source','manual_heal_v8.5','reason','11_of_12_lfs_empty','curriculum_id','98682729-caa4-451b-8e2f-f5d7fa5744bd','package_id','52cc076a-13ba-4f73-8202-b3f1164bba0f'), now());

  INSERT INTO admin_actions (action, scope, affected_ids, payload, user_id)
  VALUES (
    'manual_heal_v8.5_six_packages',
    'heal_cockpit_forensic',
    ARRAY['01099a37-3309-4bc1-a2ce-6a6913e4d125'::uuid,'65430b12-b481-46e0-88f4-c88606857da7'::uuid,'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'::uuid,'d2000000-0010-4000-8000-000000000001'::uuid,'dd000001-0005-4000-8000-000000000001'::uuid,'52cc076a-13ba-4f73-8202-b3f1164bba0f'::uuid],
    jsonb_build_object(
      'textilreiniger','stale job killed + repair re-dispatched (422 drafts)',
      'scrum_prince2','force_publish via admin_force_steps_done (broke unblock loop)',
      'content_gaps','3 repair_exam_pool_quality jobs dispatched'
    ),
    v_user
  );
END $$;