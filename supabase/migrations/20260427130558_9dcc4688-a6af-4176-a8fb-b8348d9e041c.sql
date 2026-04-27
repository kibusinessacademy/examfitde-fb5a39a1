DO $$
DECLARE
  v_test_id uuid := '2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2';
  v_before text;
  v_after text;
  v_msg text;
BEGIN
  SELECT status INTO v_before FROM public.course_packages WHERE id=v_test_id;
  RAISE NOTICE 'BEFORE: status=%', v_before;

  BEGIN
    UPDATE public.course_packages SET status='building', updated_at=now() WHERE id=v_test_id;
    SELECT status INTO v_after FROM public.course_packages WHERE id=v_test_id;
    RAISE NOTICE 'AFTER UPDATE: status=%', v_after;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE 'UPDATE FAILED: %', v_msg;
  END;
END $$;