DO $$
DECLARE
  v_curriculum uuid;
BEGIN
  UPDATE public.course_packages SET status='building', updated_at=now() WHERE id='015e3cc4-b9c4-42f1-926d-346f3844030a';
  SELECT curriculum_id INTO v_curriculum FROM public.course_packages WHERE id='015e3cc4-b9c4-42f1-926d-346f3844030a';
  PERFORM public.enqueue_job_if_absent(
    'package_repair_exam_pool_quality'::text,
    '015e3cc4-b9c4-42f1-926d-346f3844030a'::uuid,
    0, 25, NULL::timestamptz,
    jsonb_build_object('package_id','015e3cc4-b9c4-42f1-926d-346f3844030a','curriculum_id', v_curriculum, 'admin_bypass', true)
  );
END $$;