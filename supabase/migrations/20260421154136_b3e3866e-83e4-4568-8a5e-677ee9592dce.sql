
DO $$
DECLARE
  v_wave_id uuid := gen_random_uuid();
  v_pkg uuid;
  v_packages uuid[] := ARRAY[
    'a0b0c0d0-0010-4000-8000-000000000001'::uuid,  -- BWL Bachelor (war: AI_GENERATION_FAILED)
    'd2000001-0009-4000-8000-000000000001'::uuid   -- BWL-Steuern Bachelor (war: done mit guter eff_bp)
  ];
BEGIN
  UPDATE package_steps
  SET status = 'queued',
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'allow_regression', true,
        'allow_regression_by', 'ops_force_reset',
        'reset_by', 'studium_framing_validation_wave',
        'wave_id', v_wave_id,
        'reset_at', now()
      ),
      updated_at = now()
  WHERE step_key = 'auto_seed_exam_blueprints'
    AND package_id = ANY(v_packages);

  UPDATE job_queue
  SET status = 'cancelled', last_error = 'superseded_by_studium_framing_wave', updated_at = now()
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
        'source', 'studium_framing_validation_wave'
      ),
      'pending', 3, 'recovery', 95
    FROM course_packages cp WHERE cp.id = v_pkg AND cp.status = 'building';
  END LOOP;

  INSERT INTO admin_actions (action, scope, payload, affected_ids)
  VALUES (
    'studium_framing_validation_wave',
    'pipeline.seed_studium_framing',
    jsonb_build_object(
      'wave_id', v_wave_id,
      'expected', 'STUDIUM-Pakete erhalten akademisches Framing (Modul/Klausur), keine beruf=Fachkraft Mismatches mehr'
    ),
    v_packages
  );
END $$;
