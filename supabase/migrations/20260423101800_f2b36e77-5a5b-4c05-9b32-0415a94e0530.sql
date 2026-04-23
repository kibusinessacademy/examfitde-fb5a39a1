DO $$
DECLARE
  v_pkg uuid;
  v_pkgs uuid[] := ARRAY[
    '015e3cc4-b9c4-42f1-926d-346f3844030a'::uuid,
    '2ec30a3a-7d6e-42bd-a643-e78f6e4c3709'::uuid
  ];
BEGIN
  FOREACH v_pkg IN ARRAY v_pkgs LOOP
    BEGIN
      PERFORM public.enqueue_job_if_absent(
        'package_repair_exam_pool_quality'::text,
        v_pkg,
        0::int,
        25::int,
        NULL::timestamptz,
        jsonb_build_object('admin_bypass', true, 'enqueued_at', now())
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'repair_exam_pool failed for %: %', v_pkg, SQLERRM;
    END;

    BEGIN
      PERFORM public.enqueue_job_if_absent(
        'package_validate_exam_pool'::text,
        v_pkg,
        0::int,
        25::int,
        NULL::timestamptz,
        jsonb_build_object('admin_bypass', true, 'enqueued_at', now())
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'validate_exam_pool failed for %: %', v_pkg, SQLERRM;
    END;
  END LOOP;
END $$;