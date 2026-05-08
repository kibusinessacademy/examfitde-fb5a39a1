DO $heal$
DECLARE
  v_rec record;
  v_nudge jsonb;
  v_promote jsonb;
  v_pkg_ids uuid[];
  v_promoted int := 0;
  v_renudged int := 0;
  v_b_proc int := 0; v_b_err int := 0;
  v_v_proc int := 0; v_v_err int := 0;
BEGIN
  PERFORM set_config('app.allow_required_skip','on', true);

  -- A) Hotfix: 16 queued Pakete mit NON_BUILDING_PACKAGE failure → building + re-nudge
  SELECT array_agg(DISTINCT j.package_id)
  INTO v_pkg_ids
  FROM public.job_queue j
  JOIN public.course_packages cp ON cp.id=j.package_id
  WHERE j.updated_at > now() - interval '60 minutes'
    AND j.status='failed'
    AND j.last_error LIKE '%NON_BUILDING_PACKAGE%'
    AND j.job_type IN ('package_build_ai_tutor_index','package_validate_tutor_index')
    AND cp.status='queued';

  IF v_pkg_ids IS NOT NULL AND array_length(v_pkg_ids,1) > 0 THEN
    BEGIN
      SELECT public.admin_bulk_promote_queued_to_building(v_pkg_ids, 'phantom_skip_force_building_hotfix')
      INTO v_promote;
      v_promoted := COALESCE((v_promote->>'promoted')::int, 0);
    EXCEPTION WHEN OTHERS THEN
      v_promote := jsonb_build_object('error', SQLERRM);
    END;

    FOR v_rec IN SELECT unnest(v_pkg_ids) AS package_id LOOP
      BEGIN
        SELECT public.admin_nudge_atomic_trigger(v_rec.package_id, false) INTO v_nudge;
        v_renudged := v_renudged + 1;
        INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
        VALUES ('phantom_skipped_non_building_hotfix','package', v_rec.package_id, 'success',
                jsonb_build_object('nudge', v_nudge));
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
        VALUES ('phantom_skipped_non_building_hotfix','package', v_rec.package_id, 'error',
                jsonb_build_object('error', SQLERRM));
      END;
    END LOOP;
  END IF;

  -- B) Welle 4: build_ai_tutor_index, 25 — nur Pakete mit status='building'
  FOR v_rec IN
    SELECT d.package_id, d.step_key
    FROM public.v_phantom_skipped_required_drift d
    JOIN public.course_packages cp ON cp.id=d.package_id
    WHERE d.eligible = true
      AND d.step_key = 'build_ai_tutor_index'
      AND cp.status = 'building'
    ORDER BY d.approved_questions DESC NULLS LAST
    LIMIT 25
  LOOP
    BEGIN
      UPDATE public.package_steps
      SET status='queued',
          meta = COALESCE(meta,'{}'::jsonb)
                 || jsonb_build_object('phantom_skip_recovered_at', now(),
                                       'phantom_skip_recovered_by','wave4_build_ai_tutor_index_migration',
                                       'previous_skip_reason', meta->>'skip_reason')
                 - 'skip_reason' - 'last_atomic_enqueue_at',
          updated_at=now()
      WHERE package_id=v_rec.package_id AND step_key=v_rec.step_key;

      BEGIN
        SELECT public.admin_nudge_atomic_trigger(v_rec.package_id, false) INTO v_nudge;
      EXCEPTION WHEN OTHERS THEN v_nudge := jsonb_build_object('nudge_error', SQLERRM); END;

      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'success',
              jsonb_build_object('step_key', v_rec.step_key, 'wave','wave4', 'nudge', v_nudge));
      v_b_proc := v_b_proc + 1;
    EXCEPTION WHEN OTHERS THEN
      v_b_err := v_b_err + 1;
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'error',
              jsonb_build_object('step_key', v_rec.step_key, 'wave','wave4', 'error', SQLERRM));
    END;
  END LOOP;

  -- C) Validate-Welle 2: validate_tutor_index, 25 (mit Index, building)
  FOR v_rec IN
    SELECT d.package_id, d.step_key
    FROM public.v_phantom_skipped_required_drift d
    JOIN public.course_packages cp ON cp.id=d.package_id
    WHERE d.eligible = true
      AND d.step_key = 'validate_tutor_index'
      AND cp.status = 'building'
      AND EXISTS (SELECT 1 FROM public.ai_tutor_context_index i WHERE i.package_id = d.package_id)
    ORDER BY d.approved_questions DESC NULLS LAST
    LIMIT 25
  LOOP
    BEGIN
      UPDATE public.package_steps
      SET status='queued',
          meta = COALESCE(meta,'{}'::jsonb)
                 || jsonb_build_object('phantom_skip_recovered_at', now(),
                                       'phantom_skip_recovered_by','wave2_validate_tutor_index_migration',
                                       'previous_skip_reason', meta->>'skip_reason')
                 - 'skip_reason' - 'last_atomic_enqueue_at',
          updated_at=now()
      WHERE package_id=v_rec.package_id AND step_key=v_rec.step_key;

      BEGIN
        SELECT public.admin_nudge_atomic_trigger(v_rec.package_id, false) INTO v_nudge;
      EXCEPTION WHEN OTHERS THEN v_nudge := jsonb_build_object('nudge_error', SQLERRM); END;

      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'success',
              jsonb_build_object('step_key', v_rec.step_key, 'wave','validate_wave2','nudge', v_nudge));
      v_v_proc := v_v_proc + 1;
    EXCEPTION WHEN OTHERS THEN
      v_v_err := v_v_err + 1;
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'error',
              jsonb_build_object('step_key', v_rec.step_key, 'wave','validate_wave2','error', SQLERRM));
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('phantom_skipped_required_heal_wave4_combined','system','ok',
          jsonb_build_object(
            'hotfix_force_building', jsonb_build_object('promoted', v_promoted, 'renudged', v_renudged, 'pkg_ids', v_pkg_ids),
            'build_ai_tutor_index', jsonb_build_object('processed', v_b_proc, 'errors', v_b_err),
            'validate_tutor_index', jsonb_build_object('processed', v_v_proc, 'errors', v_v_err)
          ));
END
$heal$;