DO $$
DECLARE v_result jsonb;
BEGIN
  -- Wähle die 5-Argument-Variante explizit über benannte Parameter
  SELECT public.admin_force_steps_done(
    p_package_id := 'dd000001-0005-4000-8000-000000000001'::uuid,
    p_step_keys := ARRAY['generate_oral_exam']::text[],
    p_reason := 'manual_admin: 0/15 oral_exam blueprints — bypass to unblock auto_publish (queue analysis 2026-04-26)'::text,
    p_emergency_bypass := true,
    p_force_publish := false
  ) INTO v_result;

  RAISE NOTICE 'admin_force_steps_done result: %', v_result;
END $$;

UPDATE public.job_queue
SET status = 'cancelled',
    completed_at = now(),
    updated_at = now(),
    last_error = 'MANUAL_ADMIN_CANCEL: step force-done via admin_force_steps_done',
    last_error_code = 'ADMIN_FORCE_DONE',
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'cancelled_by', 'manual_admin_hotfix',
      'cancelled_at', now()::text,
      'reason', 'oral exam force-done due to insufficient blueprints'
    )
WHERE id = 'be6d67f2-de78-446d-83e3-7991acc54646'
  AND status IN ('pending','processing','queued','enqueued','batch_pending');

INSERT INTO public.auto_heal_log(
  action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
) VALUES (
  'manual_oral_exam_force_done', 'queue_analysis_2026_04_26', 'package',
  'dd000001-0005-4000-8000-000000000001', 'applied',
  'Force-done generate_oral_exam + cancel parked job to unblock pipeline',
  jsonb_build_object(
    'package_id', 'dd000001-0005-4000-8000-000000000001',
    'job_id', 'be6d67f2-de78-446d-83e3-7991acc54646',
    'step', 'generate_oral_exam'
  )
);