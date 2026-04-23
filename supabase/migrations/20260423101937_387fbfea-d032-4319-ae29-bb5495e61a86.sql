DO $$
DECLARE
  v_pkg uuid;
  v_pkgs uuid[] := ARRAY[
    '015e3cc4-b9c4-42f1-926d-346f3844030a'::uuid,
    '2ec30a3a-7d6e-42bd-a643-e78f6e4c3709'::uuid
  ];
  v_curriculum uuid;
BEGIN
  -- Round-trip queued steps to retrigger coupling
  UPDATE public.package_steps
     SET status = 'pending_enqueue',
         updated_at = now()
   WHERE package_id = ANY(v_pkgs)
     AND status = 'queued';

  UPDATE public.package_steps
     SET status = 'queued',
         updated_at = now(),
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('admin_force_requeue_v3_at', now())
   WHERE package_id = ANY(v_pkgs)
     AND status = 'pending_enqueue';

  -- Direct enqueue with full SSOT payload
  FOREACH v_pkg IN ARRAY v_pkgs LOOP
    SELECT curriculum_id INTO v_curriculum FROM public.course_packages WHERE id = v_pkg;
    IF v_curriculum IS NULL THEN
      RAISE NOTICE 'no curriculum_id for %', v_pkg;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.enqueue_job_if_absent(
        'package_repair_exam_pool_quality'::text,
        v_pkg,
        0,
        25,
        NULL::timestamptz,
        jsonb_build_object('package_id', v_pkg, 'curriculum_id', v_curriculum, 'admin_bypass', true)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'repair enqueue failed for %: %', v_pkg, SQLERRM;
    END;

    BEGIN
      PERFORM public.enqueue_job_if_absent(
        'package_validate_exam_pool'::text,
        v_pkg,
        0,
        25,
        NULL::timestamptz,
        jsonb_build_object('package_id', v_pkg, 'curriculum_id', v_curriculum, 'admin_bypass', true)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'validate enqueue failed for %: %', v_pkg, SQLERRM;
    END;
  END LOOP;
END $$;