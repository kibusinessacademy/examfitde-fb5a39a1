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
  r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.package_steps
     WHERE package_id = ANY(v_pkg_ids) AND status = 'queued'
  LOOP
    BEGIN
      UPDATE public.package_steps SET status = 'pending_enqueue' WHERE id = r.id;
      UPDATE public.package_steps
         SET status = 'queued',
             meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
                      'admin_recouple_at', now(),
                      'allow_regression', true,
                      'allow_regression_by', 'admin_manual'
                    )
       WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Recouple failed for step %: %', r.id, SQLERRM;
    END;
  END LOOP;
END $$;