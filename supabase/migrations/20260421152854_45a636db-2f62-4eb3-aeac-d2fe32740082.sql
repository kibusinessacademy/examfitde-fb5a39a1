
DO $$
DECLARE
  v_wave_id uuid := gen_random_uuid();
  v_pkg uuid;
  v_packages uuid[] := ARRAY[
    '96d0fb31-9951-408d-a83e-b2937f5a6af8'::uuid,
    '4d4e1f9f-cce9-48e7-8878-fd18eb3aedb7'::uuid,
    'd2000001-0009-4000-8000-000000000001'::uuid,
    'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'::uuid,
    'beb241ed-58dc-4ddc-930d-ca041dbde99f'::uuid,
    'a0b0c0d0-0010-4000-8000-000000000001'::uuid,
    '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8'::uuid,
    'a369b56b-f39d-4be4-9318-5ecc21d9289e'::uuid
  ];
BEGIN
  UPDATE package_steps
  SET status = 'queued',
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'allow_regression', true,
        'allow_regression_by', 'ops_force_reset',
        'reset_by', 'controlled_reseed_wave_postcondition_validation',
        'wave_id', v_wave_id,
        'reset_at', now()
      ),
      updated_at = now()
  WHERE step_key = 'auto_seed_exam_blueprints'
    AND package_id = ANY(v_packages);

  UPDATE job_queue
  SET status = 'cancelled',
      last_error = 'superseded_by_controlled_reseed_wave',
      updated_at = now()
  WHERE job_type = 'package_auto_seed_exam_blueprints'
    AND status IN ('pending','processing','retry')
    AND (payload->>'package_id')::uuid = ANY(v_packages);

  FOREACH v_pkg IN ARRAY v_packages LOOP
    INSERT INTO job_queue (job_type, payload, status, max_attempts, lane, priority)
    SELECT
      'package_auto_seed_exam_blueprints',
      jsonb_build_object(
        'package_id', v_pkg,
        'curriculum_id', cp.curriculum_id,
        'wave_id', v_wave_id,
        'source', 'controlled_reseed_wave_postcondition_validation'
      ),
      'pending',
      3,
      'recovery',
      90
    FROM course_packages cp
    WHERE cp.id = v_pkg AND cp.status = 'building';
  END LOOP;

  INSERT INTO admin_actions (action, scope, payload, affected_ids)
  VALUES (
    'controlled_reseed_wave_postcondition_validation',
    'pipeline.seed_postcondition',
    jsonb_build_object(
      'wave_id', v_wave_id,
      'package_count', array_length(v_packages, 1),
      'expected', jsonb_build_object(
        'A_good_done', ARRAY['96d0fb31-9951-408d-a83e-b2937f5a6af8','4d4e1f9f-cce9-48e7-8878-fd18eb3aedb7','d2000001-0009-4000-8000-000000000001'],
        'B_must_fail_seed_insufficient', ARRAY['bae6fc7b-6c03-4716-aeb5-5a84d9bb83af','beb241ed-58dc-4ddc-930d-ca041dbde99f','a0b0c0d0-0010-4000-8000-000000000001'],
        'C_edge_cases', ARRAY['49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8','a369b56b-f39d-4be4-9318-5ecc21d9289e']
      ),
      'started_at', now()
    ),
    v_packages
  );
END $$;
