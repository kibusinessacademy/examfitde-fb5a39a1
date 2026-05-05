DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM course_packages
     WHERE (feature_flags->'bronze'->>'requires_review')::boolean=true
       AND feature_flags ? 'admin_force_building_at'
       AND COALESCE((feature_flags->'bronze'->>'manual_bypass')::boolean,false)=false
  LOOP
    UPDATE course_packages
       SET feature_flags = jsonb_set(
             jsonb_set(feature_flags,'{bronze,manual_bypass}','true'::jsonb,true),
             '{bronze,manual_bypass_at}', to_jsonb(now()::text), true)
     WHERE id = r.id;
    INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
    VALUES ('manual_bypass_bronze_loop','package',r.id::text,'success',
            jsonb_build_object('reason','admin_force_building_overrides_bronze','operator','migration_sweep'));
  END LOOP;
END $$;