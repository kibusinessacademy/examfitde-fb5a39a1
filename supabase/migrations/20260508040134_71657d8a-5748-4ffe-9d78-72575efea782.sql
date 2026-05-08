DO $heal$
DECLARE
  v_rec record;
  v_nudge jsonb;
  v_done_promoted int := 0;
  v_queued_promoted int := 0;
  v_oral_proc int := 0; v_oral_err int := 0;
  v_done_ids uuid[];
  v_queued_ids uuid[];
  v_active_building int;
  v_wip_cap int := 75;
BEGIN
  PERFORM set_config('app.allow_required_skip','on', true);

  -- ─── A) 3 done-Pakete (Tutor-Index-Step phantom-recovered) → building ───
  SELECT array_agg(DISTINCT ps.package_id)
  INTO v_done_ids
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id=ps.package_id
  WHERE ps.status='queued'
    AND ps.meta ? 'phantom_skip_recovered_at'
    AND ps.step_key IN ('build_ai_tutor_index','validate_tutor_index')
    AND cp.status='done';

  IF v_done_ids IS NOT NULL THEN
    UPDATE public.course_packages
    SET status='building',
        feature_flags = COALESCE(feature_flags,'{}'::jsonb)
                       || jsonb_build_object('phantom_recovery_done_to_building', jsonb_build_object('at', now(), 'reason','tutor_index_phantom_recovered_on_done'))
    WHERE id = ANY(v_done_ids);
    GET DIAGNOSTICS v_done_promoted = ROW_COUNT;

    FOR v_rec IN SELECT unnest(v_done_ids) AS pid LOOP
      BEGIN
        SELECT public.admin_nudge_atomic_trigger(v_rec.pid, false) INTO v_nudge;
      EXCEPTION WHEN OTHERS THEN v_nudge := jsonb_build_object('error', SQLERRM); END;
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_recovery_done_to_building','package', v_rec.pid, 'success', jsonb_build_object('nudge', v_nudge));
    END LOOP;
  END IF;

  -- ─── B) Top 25 queued phantom-recovered → building (WIP-Cap-respektierend) ───
  SELECT COUNT(*) INTO v_active_building FROM public.course_packages WHERE status='building';

  IF v_active_building < v_wip_cap THEN
    SELECT array_agg(pid)
    INTO v_queued_ids
    FROM (
      SELECT DISTINCT ps.package_id AS pid
      FROM public.package_steps ps
      JOIN public.course_packages cp ON cp.id=ps.package_id
      WHERE ps.status='queued'
        AND ps.meta ? 'phantom_skip_recovered_at'
        AND ps.step_key IN ('build_ai_tutor_index','validate_tutor_index')
        AND cp.status='queued'
        AND NOT EXISTS (
          SELECT 1 FROM public.job_queue j
          WHERE j.package_id=ps.package_id
            AND j.job_type IN ('package_build_ai_tutor_index','package_validate_tutor_index')
            AND j.status IN ('pending','processing')
        )
      ORDER BY ps.package_id
      LIMIT LEAST(25, v_wip_cap - v_active_building)
    ) sub;

    IF v_queued_ids IS NOT NULL THEN
      UPDATE public.course_packages
      SET status='building',
          feature_flags = COALESCE(feature_flags,'{}'::jsonb)
                         || jsonb_build_object('phantom_recovery_queued_to_building', jsonb_build_object('at', now(), 'wave','wave5_hotfix'))
      WHERE id = ANY(v_queued_ids);
      GET DIAGNOSTICS v_queued_promoted = ROW_COUNT;

      FOR v_rec IN SELECT unnest(v_queued_ids) AS pid LOOP
        BEGIN
          SELECT public.admin_nudge_atomic_trigger(v_rec.pid, false) INTO v_nudge;
        EXCEPTION WHEN OTHERS THEN v_nudge := jsonb_build_object('error', SQLERRM); END;
        INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
        VALUES ('phantom_recovery_queued_to_building','package', v_rec.pid, 'success', jsonb_build_object('nudge', v_nudge, 'wave','wave5_hotfix'));
      END LOOP;
    END IF;
  END IF;

  -- ─── C) Oral-Welle 1: generate_oral_exam, 25 (building only) ───
  FOR v_rec IN
    SELECT ps.package_id, ps.step_key
    FROM public.package_steps ps
    JOIN public.course_packages cp ON cp.id=ps.package_id
    WHERE ps.step_key='generate_oral_exam'
      AND ps.status='skipped'
      AND cp.status='building'
      AND (ps.meta->>'skip_reason' IS NULL
           OR ps.meta->>'skip_reason' LIKE 'phantom%'
           OR ps.meta->>'skip_reason' LIKE 'data_holes%'
           OR ps.meta->>'skip_reason' LIKE 'sweep%')
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue j
        WHERE j.package_id=ps.package_id
          AND j.job_type='package_generate_oral_exam'
          AND j.status IN ('pending','processing')
      )
    ORDER BY ps.package_id
    LIMIT 25
  LOOP
    BEGIN
      UPDATE public.package_steps
      SET status='queued',
          meta = COALESCE(meta,'{}'::jsonb)
                 || jsonb_build_object('phantom_skip_recovered_at', now(),
                                       'phantom_skip_recovered_by','wave1_generate_oral_exam_migration',
                                       'previous_skip_reason', meta->>'skip_reason')
                 - 'skip_reason' - 'last_atomic_enqueue_at',
          updated_at=now()
      WHERE package_id=v_rec.package_id AND step_key=v_rec.step_key;

      BEGIN
        SELECT public.admin_nudge_atomic_trigger(v_rec.package_id, false) INTO v_nudge;
      EXCEPTION WHEN OTHERS THEN v_nudge := jsonb_build_object('error', SQLERRM); END;

      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'success',
              jsonb_build_object('step_key', v_rec.step_key, 'wave','oral_wave1','nudge', v_nudge));
      v_oral_proc := v_oral_proc + 1;
    EXCEPTION WHEN OTHERS THEN
      v_oral_err := v_oral_err + 1;
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'error',
              jsonb_build_object('step_key', v_rec.step_key, 'wave','oral_wave1','error', SQLERRM));
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('phantom_skipped_required_heal_wave5_combined','system','ok',
          jsonb_build_object(
            'done_to_building', jsonb_build_object('promoted', v_done_promoted, 'pkg_ids', v_done_ids),
            'queued_to_building', jsonb_build_object('promoted', v_queued_promoted, 'wip_cap', v_wip_cap, 'active_building_pre', v_active_building, 'pkg_ids', v_queued_ids),
            'generate_oral_exam', jsonb_build_object('processed', v_oral_proc, 'errors', v_oral_err)
          ));
END
$heal$;