-- PR-B First-Run: heal validate_exam_pool on b064f0c5
DO $$
DECLARE
  v_pkg uuid := 'b064f0c5-489b-4469-b7e0-774b4ca4f445';
  v_step text := 'validate_exam_pool';
  v_before jsonb;
  v_after  jsonb;
  v_nudge  jsonb;
BEGIN
  PERFORM set_config('app.allow_required_skip','on', true);

  SELECT to_jsonb(ps) INTO v_before
  FROM public.package_steps ps WHERE ps.package_id=v_pkg AND ps.step_key=v_step;

  IF v_before IS NULL THEN RAISE EXCEPTION 'step row not found'; END IF;

  UPDATE public.package_steps
  SET status='queued',
      meta = COALESCE(meta,'{}'::jsonb)
             || jsonb_build_object(
                  'phantom_skip_recovered_at', now(),
                  'phantom_skip_recovered_by', 'pr_b_first_run_manual',
                  'previous_skip_reason', meta->>'skip_reason',
                  'previous_status', 'skipped'
                )
             - 'skip_reason'
             - 'last_atomic_enqueue_at',
      updated_at = now()
  WHERE package_id=v_pkg AND step_key=v_step;

  -- nudge atomic
  BEGIN
    SELECT public.admin_nudge_atomic_trigger(v_pkg, false) INTO v_nudge;
  EXCEPTION WHEN OTHERS THEN
    v_nudge := jsonb_build_object('nudge_error', SQLERRM);
  END;

  SELECT to_jsonb(ps) INTO v_after
  FROM public.package_steps ps WHERE ps.package_id=v_pkg AND ps.step_key=v_step;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('phantom_skipped_required_heal','package', v_pkg, 'success',
          jsonb_build_object(
            'step_key', v_step,
            'mode','pr_b_first_run_manual_bypass',
            'before_status', v_before->>'status',
            'after_status', v_after->>'status',
            'previous_skip_reason', v_before->'meta'->>'skip_reason',
            'nudge_result', v_nudge
          ));

  RAISE NOTICE 'PR-B HEAL: % step % → %, nudge=%',
    v_pkg, v_step, v_after->>'status', v_nudge;
END $$;