WITH targets AS (
  SELECT id FROM course_packages
   WHERE (feature_flags->'bronze'->>'requires_review')::boolean = true
     AND feature_flags ? 'admin_force_building_at'
   FOR UPDATE SKIP LOCKED
),
upd AS (
  UPDATE course_packages cp
     SET feature_flags = jsonb_set(
           jsonb_set(feature_flags, '{bronze,manual_bypass}', 'true'::jsonb, true),
           '{bronze,manual_bypass_at}', to_jsonb(now()::text), true
         )
   FROM targets t
   WHERE cp.id = t.id
   RETURNING cp.id
)
INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
SELECT 'manual_bypass_bronze_loop','package', id::text, 'success',
       jsonb_build_object('reason','admin_force_building_overrides_bronze','operator','migration')
FROM upd;