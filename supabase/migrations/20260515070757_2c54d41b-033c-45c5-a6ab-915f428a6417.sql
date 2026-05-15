DO $$
DECLARE
  v_intent text;
  v_result jsonb;
  v_total int := 0;
  v_enqueued int := 0;
  v_skipped int := 0;
  v_summary jsonb := '[]'::jsonb;
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('769495e4-51e6-4ec5-9844-f04c03629d75'::uuid, 'fa931e34-52ee-4296-889f-303575b088d5'::uuid, '69763fe9-3bbb-474e-8082-0be8fcbb917d'::uuid),
      ('75359e28-34f6-422a-aa0a-9b73d271271d'::uuid, '3e070545-c555-417a-a047-c7541ebb2a7c'::uuid, '65c28e15-2e5a-4f78-b090-f2e150a0105e'::uuid),
      ('d1000000-0006-4000-8000-000000000001'::uuid, 'd2000000-0006-4000-8000-000000000001'::uuid, '7b2925ab-452e-486e-a1ed-42e2424bb931'::uuid),
      ('225a26f3-cb03-4d0a-aac1-ba8fd1442272'::uuid, '65430b12-b481-46e0-88f4-c88606857da7'::uuid, '40c02459-1709-473c-b9a5-7ec9b671c2b6'::uuid),
      ('aa000001-0005-4000-8000-000000000001'::uuid, 'dd000001-0005-4000-8000-000000000001'::uuid, 'dbece530-3277-4f2d-bd84-a032484773ba'::uuid),
      ('d1000000-0014-4000-8000-000000000001'::uuid, 'd2000000-0014-4000-8000-000000000001'::uuid, 'b367d709-b567-4a6e-affc-1c27a78f69cf'::uuid)
    ) AS t(curriculum_id, package_id, competency_id)
  LOOP
    FOREACH v_intent IN ARRAY ARRAY['intent_pruefungsfragen','intent_lernplan','intent_durchfallquote','intent_typische_fehler']
    LOOP
      v_total := v_total + 1;
      v_result := admin_seo_wave_enqueue_one(
        p_curriculum_id := r.curriculum_id,
        p_competency_id := r.competency_id,
        p_package_id    := r.package_id,
        p_intent_key    := v_intent,
        p_persona_type  := 'azubi',
        p_wave          := 3,
        p_enqueue_source := 'wave3c_2026-05-15',
        p_priority      := 5,
        p_dry_run       := false
      );
      IF (v_result->>'status') = 'enqueued' THEN
        v_enqueued := v_enqueued + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
      v_summary := v_summary || jsonb_build_array(jsonb_build_object(
        'pkg', r.package_id, 'intent', v_intent, 'result', v_result
      ));
    END LOOP;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES (
    'seo_wave_3c_enqueue_summary',
    'system',
    CASE WHEN v_enqueued = v_total THEN 'success'
         WHEN v_enqueued > 0 THEN 'partial'
         ELSE 'noop' END,
    format('Wave 3c: %s/%s enqueued, %s skipped', v_enqueued, v_total, v_skipped),
    jsonb_build_object('wave','3c','total',v_total,'enqueued',v_enqueued,'skipped',v_skipped,'details',v_summary)
  );
END $$;