DO $$
DECLARE
  v_pkg_ids uuid[] := ARRAY[
    '06cb247b-4d18-5698-a270-6c5d5c0794d8',
    '091fb5ed-3bea-5e0b-840e-e07845a5ebc5'
  ]::uuid[];
  v_pkg uuid;
  v_curr uuid;
  v_jid uuid;
BEGIN
  UPDATE public.course_packages SET status='building', blocked_reason=NULL, updated_at=now()
   WHERE id = ANY(v_pkg_ids);

  FOREACH v_pkg IN ARRAY v_pkg_ids LOOP
    SELECT curriculum_id INTO v_curr FROM public.course_packages WHERE id = v_pkg;
    IF v_curr IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.job_queue WHERE package_id=v_pkg AND job_type='package_validate_exam_pool' AND status IN ('pending','queued','processing','running','retry')) THEN CONTINUE; END IF;
    INSERT INTO public.job_queue (id, job_type, package_id, payload, status, priority, created_at, updated_at, lane)
    VALUES (gen_random_uuid(), 'package_validate_exam_pool', v_pkg,
            jsonb_build_object('package_id',v_pkg,'curriculum_id',v_curr,'source','admin_bypass_2026-04-23T15:52','admin_bypass',true),
            'pending', 100, now(), now(), 'recovery')
    RETURNING id INTO v_jid;
    RAISE NOTICE 'Inserted % for %', v_jid, v_pkg;
  END LOOP;
END $$;