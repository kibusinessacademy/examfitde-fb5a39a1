DO $$
DECLARE r record; v_unlocked int := 0; v_pkgs jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    WITH eligible AS (
      SELECT cp.id AS package_id, cp.title,
             (SELECT COUNT(*) FROM public.exam_questions eq
               WHERE eq.package_id=cp.id AND eq.status='approved') AS approved_q,
             (SELECT COUNT(*) FROM public.job_queue jq
               WHERE jq.status='pending'
                 AND (jq.payload->>'package_id')::uuid = cp.id
                 AND jq.job_type IN ('package_run_integrity_check','package_quality_council','package_auto_publish')
                 AND COALESCE((jq.payload->>'bronze_lock_override')::boolean,false) = false
             ) AS locked_tail_jobs
      FROM public.course_packages cp
      WHERE ((cp.feature_flags->'bronze')->>'locked')::boolean = true
        AND cp.status = 'building'
    )
    SELECT * FROM eligible
    WHERE approved_q >= 50 AND locked_tail_jobs > 0
    ORDER BY approved_q DESC
    LIMIT 5
  LOOP
    UPDATE public.job_queue
       SET payload = payload || jsonb_build_object('bronze_lock_override', true),
           run_after = now(),
           updated_at = now()
     WHERE status='pending'
       AND (payload->>'package_id')::uuid = r.package_id
       AND job_type IN ('package_run_integrity_check','package_quality_council','package_auto_publish');
    GET DIAGNOSTICS v_unlocked = ROW_COUNT;
    v_pkgs := v_pkgs || jsonb_build_object(
      'package_id', r.package_id, 'title', r.title,
      'approved_q', r.approved_q, 'unlocked_jobs', v_unlocked
    );
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('bronze_tail_auto_unlock','system','success',
          jsonb_build_object('packages', v_pkgs, 'p_max', 5, 'invoked_by','migration_manual_exec'));

  RAISE NOTICE 'unlock_result: %', jsonb_build_object('packages', v_pkgs, 'count', jsonb_array_length(v_pkgs));
END$$;