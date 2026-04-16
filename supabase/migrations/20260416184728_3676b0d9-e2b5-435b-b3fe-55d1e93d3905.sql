DO $$
DECLARE
  v_cancelled_ids uuid[];
  v_pkgs_to_requeue uuid[];
  v_new_job_count int := 0;
  v_pkg uuid;
  v_curr uuid;
BEGIN
  SELECT array_agg(id), array_agg(DISTINCT package_id)
    INTO v_cancelled_ids, v_pkgs_to_requeue
  FROM public.job_queue
  WHERE job_type = 'package_run_integrity_check'
    AND status = 'processing';

  IF v_cancelled_ids IS NULL OR array_length(v_cancelled_ids, 1) IS NULL THEN
    RAISE NOTICE '[integrity-cleanup] no stuck processing jobs found';
    RETURN;
  END IF;

  UPDATE public.job_queue
  SET status = 'cancelled',
      completed_at = now(),
      last_error = 'PRE_HEARTBEAT_MIGRATION_CANCEL: monolithic integrity-check exceeded edge runtime; replaced by heartbeat-instrumented job',
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'cancel_reason', 'pre_heartbeat_migration_cancel',
        'cancelled_at', now(),
        'cancelled_by', 'migration:integrity-check-heartbeat-v1'
      ),
      updated_at = now()
  WHERE id = ANY(v_cancelled_ids);

  FOREACH v_pkg IN ARRAY v_pkgs_to_requeue LOOP
    SELECT curriculum_id INTO v_curr
    FROM public.course_packages WHERE id = v_pkg AND status = 'building';

    IF v_curr IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.job_queue
      WHERE package_id = v_pkg
        AND job_type = 'package_run_integrity_check'
        AND status IN ('pending', 'queued', 'processing')
    ) THEN
      INSERT INTO public.job_queue (
        job_type, status, priority, payload, package_id,
        max_attempts, run_after, created_at, updated_at, meta
      ) VALUES (
        'package_run_integrity_check', 'pending', 8,
        jsonb_build_object('package_id', v_pkg, 'curriculum_id', v_curr),
        v_pkg, 5, now(), now(), now(),
        jsonb_build_object(
          'enqueued_by', 'migration:integrity-check-heartbeat-v1',
          'reason', 'fresh_run_after_heartbeat_deploy'
        )
      );
      v_new_job_count := v_new_job_count + 1;
    END IF;
  END LOOP;

  INSERT INTO public.admin_actions (action, scope, payload, affected_ids)
  VALUES (
    'integrity_check_heartbeat_migration',
    'pipeline',
    jsonb_build_object(
      'cancelled_jobs', array_length(v_cancelled_ids, 1),
      'packages_affected', COALESCE(array_length(v_pkgs_to_requeue, 1), 0),
      'fresh_jobs_enqueued', v_new_job_count,
      'reason', 'monolithic integrity-check timing out on >800 approved questions; heartbeat instrumentation deployed'
    ),
    v_cancelled_ids
  );

  RAISE NOTICE '[integrity-cleanup] done: cancelled=% requeued=%',
    array_length(v_cancelled_ids, 1), v_new_job_count;
END $$;