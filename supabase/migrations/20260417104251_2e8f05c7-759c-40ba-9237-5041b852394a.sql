-- Heal v8.7.5: Package-Level Fan-Out (1 Job pro Paket → Edge Function macht Sub-Fanout)
DO $$
DECLARE
  v_user uuid := 'b0dbd616-9b93-47c8-83c5-39290130a6ea';
  v_targets uuid[] := ARRAY[
    'ec0183bd-1b37-4da1-81ce-6924e07a7397','3f416f2f-4364-460c-8924-caa2316a12d0',
    'f1356e6b-995b-4b63-aee4-3d513da1b3f6','e72f7008-3007-4b9c-b0b4-2a73d8e865e5',
    '4d4e1f9f-cce9-48e7-8878-fd18eb3aedb7','7472b96f-22ed-493f-9aca-74e70ebcaf8e',
    'e008fc3b-6773-4935-8301-c440470b204c','55036b44-7427-438f-81f2-3707c804d41f',
    'c9d82e46-b7b0-4752-a6b1-53534c7e1666','2aba85aa-a4a2-4aa3-ae65-06f401317d35',
    'e43c6cc6-ef18-4c72-a552-07d03ff8e14f','0d351bb2-fea3-44a3-88ec-df14eefb269f'
  ]::uuid[];
  v_pkg uuid; v_curr uuid;
BEGIN
  FOREACH v_pkg IN ARRAY v_targets LOOP
    SELECT curriculum_id INTO v_curr FROM course_packages WHERE id=v_pkg;

    -- Package-level dispatch (kein blueprint_id → Edge Function macht selbst Fan-Out)
    INSERT INTO job_queue (job_type, package_id, status, payload, priority, created_at)
    VALUES ('blueprint_generate_variants', v_pkg, 'pending',
      jsonb_build_object(
        'package_id', v_pkg,
        'curriculum_id', v_curr,
        'target_count', 5,
        'reason', 'heal_v8.7.5_package_fanout',
        'source', 'admin_pipeline_recovery'
      ),
      6, now())
    ON CONFLICT DO NOTHING;
  END LOOP;

  INSERT INTO admin_actions (action, scope, affected_ids, payload, user_id)
  VALUES ('heal_v8.7.5_package_fanout','pipeline_prebuild', v_targets,
    jsonb_build_object('strategy','package_level_dispatch_self_fanout'), v_user);
END $$;