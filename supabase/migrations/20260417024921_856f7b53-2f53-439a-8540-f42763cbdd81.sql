DO $$
DECLARE
  v_deleted integer;
  v_requeued integer;
BEGIN
  ALTER TABLE public.job_queue DISABLE TRIGGER trg_guard_terminal_status_regression;
  ALTER TABLE public.job_queue DISABLE TRIGGER trg_stamp_cancel_audit;

  -- 1. Delete failed Jobs, deren Idempotency-Key bereits durch aktiven Twin belegt ist
  WITH failed_with_twin AS (
    SELECT f.id
    FROM public.job_queue f
    WHERE f.status = 'failed'
      AND f.created_at > now() - interval '7 days'
      AND EXISTS (
        SELECT 1 FROM public.job_queue a
        WHERE a.id <> f.id
          AND a.package_id = f.package_id
          AND a.job_type = f.job_type
          AND a.status IN ('pending','processing')
          AND COALESCE(a.payload->>'learning_field_filter','__root__') = COALESCE(f.payload->>'learning_field_filter','__root__')
          AND COALESCE(a.payload->>'lesson_id','__all__') = COALESCE(f.payload->>'lesson_id','__all__')
          AND COALESCE(a.payload->>'blueprint_id','__all__') = COALESCE(f.payload->>'blueprint_id','__all__')
      )
  )
  DELETE FROM public.job_queue WHERE id IN (SELECT id FROM failed_with_twin);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- 2. Verbleibende failed → pending
  UPDATE public.job_queue
  SET status = 'pending',
      attempts = 0,
      locked_at = NULL,
      locked_by = NULL,
      run_after = now() + (random() * interval '30 seconds'),
      last_error = NULL,
      last_error_code = NULL,
      last_error_severity = NULL,
      rate_limited_until = NULL,
      updated_at = now()
  WHERE status = 'failed'
    AND created_at > now() - interval '7 days';
  GET DIAGNOSTICS v_requeued = ROW_COUNT;

  ALTER TABLE public.job_queue ENABLE TRIGGER trg_guard_terminal_status_regression;
  ALTER TABLE public.job_queue ENABLE TRIGGER trg_stamp_cancel_audit;

  INSERT INTO public.admin_actions (action, scope, payload)
  VALUES (
    'manual_force_requeue_all_failed',
    'pipeline',
    jsonb_build_object(
      'deleted_duplicates', v_deleted,
      'requeued', v_requeued,
      'reason', 'manual_bypass_runner_optimization',
      'timestamp', now()
    )
  );
END $$;