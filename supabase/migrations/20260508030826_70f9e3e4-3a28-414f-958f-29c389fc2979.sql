DO $wave2$
DECLARE
  v_rec record;
  v_processed int := 0;
  v_errors int := 0;
  v_renudged int := 0;
  v_nudge jsonb;
BEGIN
  PERFORM set_config('app.allow_required_skip','on', true);

  -- Re-Nudge Stragglers aus Wave-1
  FOR v_rec IN
    WITH w1 AS (
      SELECT DISTINCT target_id::uuid AS pkg
      FROM public.auto_heal_log
      WHERE action_type='phantom_skipped_required_heal'
        AND metadata->>'wave'='wave1'
    )
    SELECT cp.id AS package_id
    FROM public.course_packages cp
    JOIN w1 ON cp.id=w1.pkg
    JOIN public.package_steps ps ON ps.package_id=cp.id AND ps.step_key='build_ai_tutor_index'
    WHERE ps.status='queued'
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue j
        WHERE j.package_id=cp.id
          AND j.job_type='package_build_ai_tutor_index'
          AND j.status IN ('pending','processing')
      )
  LOOP
    BEGIN
      SELECT public.admin_nudge_atomic_trigger(v_rec.package_id, false) INTO v_nudge;
      v_renudged := v_renudged + 1;
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_wave1_renudge','package', v_rec.package_id, 'success',
              jsonb_build_object('nudge', v_nudge));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_wave1_renudge','package', v_rec.package_id, 'error',
              jsonb_build_object('error', SQLERRM));
    END;
  END LOOP;

  -- Welle 2 — 25 neue
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
                      'phantom_skip_recovered_by', 'wave2_build_ai_tutor_index_migration',
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
              jsonb_build_object('step_key', v_rec.step_key, 'wave', 'wave2', 'nudge', v_nudge));

      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'error',
              jsonb_build_object('step_key', v_rec.step_key, 'wave','wave2','error', SQLERRM));
    END;
  END LOOP;

  RAISE NOTICE 'Wave2: processed=%, errors=%, renudged=%', v_processed, v_errors, v_renudged;
END
$wave2$;