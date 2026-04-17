-- Heal v8.7.3: Re-Enqueue mit korrigiertem Routing (generate-blueprint-variants statt blueprint-seed-by-competency)
DO $$
DECLARE
  v_targets uuid[] := ARRAY[
    'ec0183bd-1b37-4da1-81ce-6924e07a7397','3f416f2f-4364-460c-8924-caa2316a12d0',
    'f1356e6b-995b-4b63-aee4-3d513da1b3f6','e72f7008-3007-4b9c-b0b4-2a73d8e865e5',
    '4d4e1f9f-cce9-48e7-8878-fd18eb3aedb7','7472b96f-22ed-493f-9aca-74e70ebcaf8e',
    'e008fc3b-6773-4935-8301-c440470b204c','55036b44-7427-438f-81f2-3707c804d41f',
    'c9d82e46-b7b0-4752-a6b1-53534c7e1666','2aba85aa-a4a2-4aa3-ae65-06f401317d35',
    'e43c6cc6-ef18-4c72-a552-07d03ff8e14f','0d351bb2-fea3-44a3-88ec-df14eefb269f'
  ]::uuid[];
  v_pkg uuid; v_curr uuid; v_bp record; v_jobs int := 0;
BEGIN
  -- 1) Cancel ALL stale jobs (auch die "completed" ohne Daten — Job-Runner hat falschen Endpoint genutzt)
  UPDATE job_queue
  SET status='cancelled',
      last_error=COALESCE(last_error,'') || ' | heal_v8.7.3: rerouted to generate-blueprint-variants',
      updated_at=now()
  WHERE package_id = ANY(v_targets)
    AND job_type='blueprint_generate_variants'
    AND status IN ('pending','processing');

  -- 2) Pakete bleiben 'building' (OPS_GUARD-Whitelist erlaubt jetzt prebuild auch in planning/queued/blocked,
  --    aber building ist auch okay)

  -- 3) Re-Enqueue pro Blueprint mit vollem Payload
  FOREACH v_pkg IN ARRAY v_targets LOOP
    SELECT curriculum_id INTO v_curr FROM course_packages WHERE id=v_pkg;

    FOR v_bp IN
      SELECT qb.id AS blueprint_id, qb.competency_id, qb.knowledge_type, qb.cognitive_level
      FROM question_blueprints qb
      WHERE qb.curriculum_id = v_curr
        AND qb.status != 'deprecated'
    LOOP
      INSERT INTO job_queue (job_type, package_id, status, payload, priority, created_at, worker_pool)
      VALUES ('blueprint_generate_variants', v_pkg, 'pending',
        jsonb_build_object(
          'package_id', v_pkg,
          'curriculum_id', v_curr,
          'blueprint_id', v_bp.blueprint_id,
          'competency_id', v_bp.competency_id,
          'knowledge_type', v_bp.knowledge_type,
          'cognitive_level', v_bp.cognitive_level,
          'target_count', 5,
          'reason', 'heal_v8.7.3_correct_routing',
          'source', 'admin_pipeline_recovery'
        ),
        5, now(), 'prebuild')
      ON CONFLICT DO NOTHING;
      v_jobs := v_jobs + 1;
    END LOOP;
  END LOOP;

  INSERT INTO admin_actions (action, scope, affected_ids, payload, user_id)
  VALUES ('heal_v8.7.3_correct_variant_routing','pipeline_prebuild', v_targets,
    jsonb_build_object('jobs_enqueued', v_jobs, 'fix','job-map.ts: blueprint_generate_variants -> generate-blueprint-variants'),
    'b0dbd616-9b93-47c8-83c5-39290130a6ea');

  RAISE NOTICE 'Heal v8.7.3: % jobs re-enqueued with correct edge function', v_jobs;
END $$;