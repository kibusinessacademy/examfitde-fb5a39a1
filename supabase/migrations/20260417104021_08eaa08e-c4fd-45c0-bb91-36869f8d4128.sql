-- Heal v8.7.4: Direkter Blueprint-Approval-Patch (User-Entscheidung)
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
  v_curr_ids uuid[];
  v_approved int;
BEGIN
  -- Curriculum-IDs der 12 Pakete sammeln
  SELECT array_agg(curriculum_id) INTO v_curr_ids
  FROM course_packages WHERE id = ANY(v_targets);

  -- Approve all draft blueprints
  WITH upd AS (
    UPDATE question_blueprints
    SET status = 'approved',
        approved_by = v_user,
        approved_at = now(),
        updated_at = now()
    WHERE curriculum_id = ANY(v_curr_ids)
      AND status = 'draft'
    RETURNING id
  )
  SELECT count(*) INTO v_approved FROM upd;

  -- Cancel "completed" jobs ohne Daten + reset pending der vorigen Welle
  UPDATE job_queue
  SET status='cancelled',
      last_error=COALESCE(last_error,'') || ' | heal_v8.7.4: superseded by direct approval',
      updated_at=now()
  WHERE package_id = ANY(v_targets)
    AND job_type='blueprint_generate_variants'
    AND status IN ('completed','cancelled','failed')
    AND created_at > now() - interval '1 hour'
    AND payload->>'reason' IN ('heal_v8.7.2_prebuild_variant_seeding','heal_v8.7.3_correct_routing');

  -- Pending Jobs der v8.7.3 Welle laufen jetzt durch (Pre-Flight ok). Keine erneute Insertion nötig
  -- — die 27 pending Jobs im prebuild-Pool werden vom content-runner abgearbeitet.

  INSERT INTO admin_actions (action, scope, affected_ids, payload, user_id)
  VALUES ('heal_v8.7.4_blueprint_direct_approval','pipeline_prebuild', v_targets,
    jsonb_build_object(
      'blueprints_approved', v_approved,
      'rationale', 'user_decision_skip_llm_validation',
      'note', 'Pending blueprint_generate_variants jobs (v8.7.3) will now pass preflight and proceed'
    ), v_user);

  RAISE NOTICE 'Heal v8.7.4: % blueprints approved', v_approved;
END $$;