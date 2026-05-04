DO $$
DECLARE
  v_pkg_ids uuid[] := ARRAY[
    'ef7ba3bf-ebaf-4aaf-abb5-f6cf99b5eb87'::uuid,
    '737b0880-dff2-4251-9df5-41cfe666e6fe'::uuid,
    'c08cd3ce-1fbc-47fa-ac9a-a90a5f4f941b'::uuid,
    '8418d7c6-d708-4733-bf83-b598eee64a15'::uuid,
    'c142cef2-5efa-438e-a11c-88e387241e65'::uuid,
    '861ddde2-7427-43ab-869a-0c9f98a2ea11'::uuid,
    '9d96a0ad-4a32-4fa1-8ab6-da89856211f7'::uuid,
    '7163501c-98f4-4863-8240-467a84953465'::uuid,
    '8d66ce11-396d-4519-8cf4-5a2e91bf1ceb'::uuid,
    '7c36f3a0-8a1a-4766-a6ad-bfa7221f09dd'::uuid
  ];
  v_pkg uuid;
  v_curr uuid;
  v_existing jsonb;
  v_new_bronze jsonb;
  v_job_id uuid;
  v_reason text := 'one_time_sql_bypass: COUNCIL_DEFERRED_STALE_WORKER_3X — bronze 78, integrity ok, pricing ok';
BEGIN
  FOREACH v_pkg IN ARRAY v_pkg_ids LOOP
    SELECT feature_flags->'bronze', curriculum_id INTO v_existing, v_curr
    FROM public.course_packages WHERE id = v_pkg FOR UPDATE;

    IF v_curr IS NULL THEN
      SELECT c.curriculum_id INTO v_curr
      FROM public.courses c JOIN public.course_packages cp ON cp.course_id=c.id
      WHERE cp.id = v_pkg;
    END IF;

    v_new_bronze := COALESCE(v_existing, '{}'::jsonb) || jsonb_build_object(
      'score', 78, 'badge', 'bronze',
      'final_state', 'manual_approved', 'requires_review', false, 'repair_active', false,
      'manual_approved_at', now(),
      'manual_approved_reason', v_reason,
      'manual_approved_via', 'one_time_sql_bypass'
    );

    UPDATE public.course_packages
    SET feature_flags = COALESCE(feature_flags,'{}'::jsonb) || jsonb_build_object('bronze', v_new_bronze),
        updated_at = now()
    WHERE id = v_pkg;

    IF EXISTS (
      SELECT 1 FROM public.job_queue
      WHERE package_id = v_pkg
        AND job_type = 'package_auto_publish'
        AND status IN ('pending','processing')
    ) THEN
      v_job_id := NULL;
    ELSE
      INSERT INTO public.job_queue (package_id, job_type, status, priority, payload, meta, created_at)
      VALUES (
        v_pkg, 'package_auto_publish', 'pending', 5,
        jsonb_build_object(
          'bronze_lock_override', true,
          'reason', v_reason,
          'enqueue_source', 'bronze_manual_approve_sql_bypass',
          'package_id', v_pkg,
          'curriculum_id', v_curr,
          'step_key', 'auto_publish'
        ),
        jsonb_build_object('enqueue_source', 'bronze_manual_approve_sql_bypass', 'step_key', 'auto_publish'),
        now()
      )
      RETURNING id INTO v_job_id;
    END IF;

    INSERT INTO public.auto_heal_log (
      action_type, trigger_source, target_type, target_id, result_status, result_detail
    ) VALUES (
      'bronze_manual_approved_for_publish',
      'one_time_sql_bypass',
      'package', v_pkg, 'success',
      jsonb_build_object(
        'package_id', v_pkg, 'curriculum_id', v_curr,
        'reason', v_reason, 'score', 78, 'badge', 'bronze',
        'job_id', v_job_id
      )
    );
  END LOOP;

  UPDATE public.heal_permanent_fix_tasks
  SET status='done', completed_at=now(),
      notes = COALESCE(notes,'') || E'\nManually approved via one_time_sql_bypass (Bronze 78, integrity ok, pricing ok). Auto-publish enqueued with bronze_lock_override=true.'
  WHERE pattern_key='COUNCIL_DEFERRED_STALE_WORKER_3X'
    AND status='in_progress'
    AND package_id = ANY(v_pkg_ids);
END $$;