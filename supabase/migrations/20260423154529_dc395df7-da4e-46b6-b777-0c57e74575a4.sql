DO $$
DECLARE
  v_pkg_ids uuid[] := ARRAY[
    '01099a37-3309-4bc1-a2ce-6a6913e4d125','091fb5ed-3bea-5e0b-840e-e07845a5ebc5',
    '06cb247b-4d18-5698-a270-6c5d5c0794d8','d2000000-0010-4000-8000-000000000001',
    '42bdd4d8-846c-46e3-9b3a-c4dfcc1ea081','d2000000-0011-4000-8000-000000000001',
    '0b2f0df9-e0c1-448d-ad2d-da98e8f6c355','dd000001-0005-4000-8000-000000000001',
    'd2000000-0001-4000-8000-000000000001','ba96f6d9-c638-4bf3-aaca-3465ac363e8b',
    '21f0b991-17ef-49a7-96fb-71e076a74e7d','d1336c74-952a-4b06-8f4d-2fb826346b77',
    '176f51ad-fe34-596e-9b3d-d1c9cd23b0a9','1404f90c-210c-450c-898c-a30b73586502'
  ]::uuid[];
  v_pkg uuid;
  v_curr uuid;
  v_jid uuid;
  v_inserted int := 0;
BEGIN
  FOREACH v_pkg IN ARRAY v_pkg_ids LOOP
    SELECT curriculum_id INTO v_curr FROM public.course_packages WHERE id = v_pkg;
    IF v_curr IS NULL THEN
      RAISE NOTICE 'Skip % (no curriculum)', v_pkg;
      CONTINUE;
    END IF;

    -- Skip if a non-terminal validate_exam_pool job already exists
    IF EXISTS (
      SELECT 1 FROM public.job_queue
       WHERE package_id = v_pkg
         AND job_type = 'package_validate_exam_pool'
         AND status IN ('queued','processing','pending','running','retry')
    ) THEN
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.job_queue (
        id, job_type, package_id, payload, status, priority, created_at, updated_at, lane
      ) VALUES (
        gen_random_uuid(),
        'package_validate_exam_pool',
        v_pkg,
        jsonb_build_object(
          'package_id', v_pkg,
          'curriculum_id', v_curr,
          'source', 'admin_bypass_heal_2026-04-23T15:48',
          'admin_bypass', true
        ),
        'queued',
        100,
        now(), now(),
        'recovery'
      ) RETURNING id INTO v_jid;
      v_inserted := v_inserted + 1;
      RAISE NOTICE 'Inserted job % for package %', v_jid, v_pkg;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Insert failed for %: %', v_pkg, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Total inserted: %', v_inserted;
END $$;