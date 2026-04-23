DO $$
DECLARE
  v_pkg_ids uuid[] := ARRAY[
    '01099a37-3309-4bc1-a2ce-6a6913e4d125',
    '091fb5ed-3bea-5e0b-840e-e07845a5ebc5',
    '06cb247b-4d18-5698-a270-6c5d5c0794d8',
    'd2000000-0010-4000-8000-000000000001',
    '42bdd4d8-846c-46e3-9b3a-c4dfcc1ea081',
    'd2000000-0011-4000-8000-000000000001',
    '0b2f0df9-e0c1-448d-ad2d-da98e8f6c355',
    'dd000001-0005-4000-8000-000000000001',
    'd2000000-0001-4000-8000-000000000001',
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b',
    '21f0b991-17ef-49a7-96fb-71e076a74e7d',
    'd1336c74-952a-4b06-8f4d-2fb826346b77',
    '176f51ad-fe34-596e-9b3d-d1c9cd23b0a9',
    '1404f90c-210c-450c-898c-a30b73586502'
  ]::uuid[];
  v_pkg uuid;
  v_curr uuid;
  v_job_id uuid;
BEGIN
  -- 1) Cancel non-terminal jobs
  UPDATE public.job_queue
     SET status = 'cancelled',
         error  = COALESCE(error,'') || ' | admin_bypass_heal_2026-04-23T15:46'
   WHERE package_id = ANY(v_pkg_ids)
     AND status IN ('queued','processing','pending','retry','running');

  -- 2) Reset only non-done steps; include regression allowance for guard
  UPDATE public.package_steps
     SET meta = (COALESCE(meta,'{}'::jsonb)
                 - 'exhausted' - 'repair_exhausted' - 'hard_fail_count'
                 - 'consecutive_failures' - 'zero_progress_count'
                 - 'stale_lock_count')
                || jsonb_build_object(
                     'admin_bypass_reset_at', now(),
                     'allow_regression', true,
                     'allow_regression_by', 'admin_manual'
                   ),
         status = 'queued',
         attempts = 0
   WHERE package_id = ANY(v_pkg_ids)
     AND status <> 'done';

  -- 3) Unblock + force building
  UPDATE public.course_packages
     SET status = 'building',
         blocked_reason = NULL,
         updated_at = now()
   WHERE id = ANY(v_pkg_ids);

  -- 4) Enqueue fresh validate-exam-pool per package
  FOREACH v_pkg IN ARRAY v_pkg_ids LOOP
    SELECT curriculum_id INTO v_curr FROM public.course_packages WHERE id = v_pkg;
    IF v_curr IS NOT NULL THEN
      BEGIN
        SELECT public.enqueue_job_if_absent(
          'package_validate_exam_pool'::text,
          v_pkg,
          jsonb_build_object('package_id', v_pkg, 'curriculum_id', v_curr,
                             'source', 'admin_bypass_heal_2026-04-23T15:46')
        ) INTO v_job_id;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Enqueue failed for %: %', v_pkg, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;