DO $heal$
DECLARE
  v_rec record;
  v_nudge jsonb;
  v_b_proc int := 0; v_b_err int := 0;
  v_v_proc int := 0; v_v_err int := 0;
BEGIN
  PERFORM set_config('app.allow_required_skip','on', true);

  -- Welle 3: build_ai_tutor_index, 25
  FOR v_rec IN
    SELECT package_id, step_key
    FROM public.v_phantom_skipped_required_drift d
    WHERE d.eligible = true
      AND d.step_key = 'build_ai_tutor_index'
    ORDER BY approved_questions DESC NULLS LAST
    LIMIT 25
  LOOP
    BEGIN
      UPDATE public.package_steps
      SET status = 'queued',
          meta = COALESCE(meta,'{}'::jsonb)
                 || jsonb_build_object(
                      'phantom_skip_recovered_at', now(),
                      'phantom_skip_recovered_by', 'wave3_build_ai_tutor_index_migration',
                      'previous_skip_reason', meta->>'skip_reason'
                    )
                 - 'skip_reason'
                 - 'last_atomic_enqueue_at',
          updated_at = now()
      WHERE package_id = v_rec.package_id AND step_key = v_rec.step_key;

      BEGIN
        SELECT public.admin_nudge_atomic_trigger(v_rec.package_id, false) INTO v_nudge;
      EXCEPTION WHEN OTHERS THEN
        v_nudge := jsonb_build_object('nudge_error', SQLERRM);
      END;

      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'success',
              jsonb_build_object('step_key', v_rec.step_key, 'wave', 'wave3', 'nudge', v_nudge));
      v_b_proc := v_b_proc + 1;
    EXCEPTION WHEN OTHERS THEN
      v_b_err := v_b_err + 1;
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'error',
              jsonb_build_object('step_key', v_rec.step_key, 'wave','wave3','error', SQLERRM));
    END;
  END LOOP;

  -- Welle 1: validate_tutor_index, 25 (nur Pakete mit existierendem ai_tutor_context_index)
  FOR v_rec IN
    SELECT d.package_id, d.step_key
    FROM public.v_phantom_skipped_required_drift d
    WHERE d.eligible = true
      AND d.step_key = 'validate_tutor_index'
      AND EXISTS (
        SELECT 1 FROM public.ai_tutor_context_index i
        WHERE i.package_id = d.package_id
      )
    ORDER BY d.approved_questions DESC NULLS LAST
    LIMIT 25
  LOOP
    BEGIN
      UPDATE public.package_steps
      SET status = 'queued',
          meta = COALESCE(meta,'{}'::jsonb)
                 || jsonb_build_object(
                      'phantom_skip_recovered_at', now(),
                      'phantom_skip_recovered_by', 'wave1_validate_tutor_index_migration',
                      'previous_skip_reason', meta->>'skip_reason'
                    )
                 - 'skip_reason'
                 - 'last_atomic_enqueue_at',
          updated_at = now()
      WHERE package_id = v_rec.package_id AND step_key = v_rec.step_key;

      BEGIN
        SELECT public.admin_nudge_atomic_trigger(v_rec.package_id, false) INTO v_nudge;
      EXCEPTION WHEN OTHERS THEN
        v_nudge := jsonb_build_object('nudge_error', SQLERRM);
      END;

      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'success',
              jsonb_build_object('step_key', v_rec.step_key, 'wave', 'validate_wave1', 'nudge', v_nudge));
      v_v_proc := v_v_proc + 1;
    EXCEPTION WHEN OTHERS THEN
      v_v_err := v_v_err + 1;
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'error',
              jsonb_build_object('step_key', v_rec.step_key, 'wave','validate_wave1','error', SQLERRM));
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('phantom_skipped_required_heal_wave3_combined','system','ok',
          jsonb_build_object(
            'build_ai_tutor_index', jsonb_build_object('processed', v_b_proc, 'errors', v_b_err),
            'validate_tutor_index', jsonb_build_object('processed', v_v_proc, 'errors', v_v_err)
          ));

  RAISE NOTICE 'Wave3: build proc=%/err=%, validate proc=%/err=%', v_b_proc, v_b_err, v_v_proc, v_v_err;
END
$heal$;