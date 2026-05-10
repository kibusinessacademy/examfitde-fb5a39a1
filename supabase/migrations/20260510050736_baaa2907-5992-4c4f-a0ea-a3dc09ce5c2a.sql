-- Wave 5 — Cluster B heal: promote eligible + cancel futile repair jobs on empty packages
DO $$
DECLARE
  v_promote_result jsonb;
  v_cancelled int := 0;
  v_empty_pkg uuid;
BEGIN
  -- 1) Bulk-Promote queued packages with sufficient approved questions
  SELECT public.admin_bulk_promote_queued_to_building() INTO v_promote_result;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'wave5_cluster_b_heal',
    'system',
    NULL,
    'success',
    jsonb_build_object(
      'phase', 'bulk_promote',
      'result', v_promote_result,
      'ts', now()
    )
  );

  -- 2) Cancel pending repair jobs on packages with 0 approved questions (futile)
  FOR v_empty_pkg IN
    SELECT DISTINCT j.package_id
    FROM public.job_queue j
    WHERE j.job_type = 'package_repair_exam_pool_competency_coverage'
      AND j.status IN ('pending','failed')
      AND NOT EXISTS (
        SELECT 1 FROM public.exam_questions eq
        WHERE eq.package_id = j.package_id AND eq.status = 'approved'
      )
  LOOP
    UPDATE public.job_queue
       SET status = 'cancelled',
           completed_at = now(),
           last_error = COALESCE(last_error,'') || ' | wave5: cancelled — package has 0 approved questions, repair futile',
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
             'cancelled_by','wave5_cluster_b_heal',
             'cancelled_at', now(),
             'reason','no_approved_questions'
           )
     WHERE package_id = v_empty_pkg
       AND job_type = 'package_repair_exam_pool_competency_coverage'
       AND status IN ('pending','failed');
    GET DIAGNOSTICS v_cancelled = ROW_COUNT;

    INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
    VALUES (
      'wave5_cluster_b_heal',
      'package',
      v_empty_pkg,
      'success',
      jsonb_build_object(
        'phase','cancel_futile_repair',
        'cancelled_jobs', v_cancelled,
        'reason','no_approved_questions'
      )
    );
  END LOOP;
END $$;