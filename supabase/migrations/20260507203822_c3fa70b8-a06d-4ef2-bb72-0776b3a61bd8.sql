-- Welle 1 · build_ai_tutor_index · limit 25
-- Spiegelt admin_heal_phantom_skipped_required_steps(live) ohne auth.uid()-Gate.
DO $wave1$
DECLARE
  v_rec record;
  v_processed int := 0;
  v_errors int := 0;
  v_nudge jsonb;
BEGIN
  PERFORM set_config('app.allow_required_skip','on', true);

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
                      'phantom_skip_recovered_by', 'wave1_build_ai_tutor_index_migration',
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
              jsonb_build_object('step_key', v_rec.step_key, 'wave', 'wave1', 'nudge', v_nudge));

      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'error',
              jsonb_build_object('step_key', v_rec.step_key, 'wave','wave1','error', SQLERRM));
    END;
  END LOOP;

  RAISE NOTICE 'Wave1 build_ai_tutor_index: processed=%, errors=%', v_processed, v_errors;
END
$wave1$;