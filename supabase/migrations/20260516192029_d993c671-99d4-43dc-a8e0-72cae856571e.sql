
DO $$
BEGIN
  PERFORM set_config('council.publish_bypass', 'true', true);
  PERFORM set_config('app.m9_3b_allow_sealed_lessons_repair', 'on', true);

  UPDATE courses SET status='published'::course_status, published_at=COALESCE(published_at, now())
   WHERE id IN ('0d96a321-2e74-421a-96c0-8427ecece666','3c913066-28d5-4732-9b78-83b9360fc9fb')
     AND status <> 'published'::course_status;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('post_publish_content_repair_scaffold_m9_3c_publish_courses', 'system', 'completed',
          jsonb_build_object('course_ids', jsonb_build_array(
              '0d96a321-2e74-421a-96c0-8427ecece666','3c913066-28d5-4732-9b78-83b9360fc9fb'),
            'note','course status flipped to published so sellability view counts modules/lessons'));
END $$;
