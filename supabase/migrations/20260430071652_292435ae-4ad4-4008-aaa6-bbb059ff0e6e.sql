CREATE OR REPLACE FUNCTION public.fn_check_repair_no_progress_and_block(
  p_package_id uuid,
  p_step_key text DEFAULT 'repair_exam_pool_quality',
  p_action_type text DEFAULT 'repair_exam_pool_quality',
  p_window interval DEFAULT '4 hours'::interval,
  p_min_runs int DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_runs int; v_no_progress int;
BEGIN
  SELECT COUNT(*),
    COUNT(*) FILTER (
      WHERE COALESCE((metadata->>'promoted_to_approved')::int,0)=0
        AND COALESCE((metadata->>'difficulty_rebalanced')::int,0)=0
        AND COALESCE((metadata->>'traps_tagged')::int,0)=0
        AND COALESCE((metadata->>'bloom_repaired')::int,0)=0
        AND COALESCE((metadata->>'qc_reconciled')::int,0)=0
    )
  INTO v_runs, v_no_progress
  FROM (
    SELECT metadata FROM auto_heal_log
    WHERE action_type = p_action_type
      AND (target_id = p_package_id::text OR (metadata->>'package_id') = p_package_id::text)
      AND created_at > now() - p_window
    ORDER BY created_at DESC
    LIMIT p_min_runs
  ) t;

  IF v_runs >= p_min_runs AND v_no_progress = v_runs THEN
    UPDATE package_steps
    SET status='blocked'::step_status,
        last_error='NO_PROGRESS_TERMINAL: '||v_runs||' consecutive runs with zero progress',
        meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object(
          'no_progress_terminal',true,'runs_evaluated',v_runs,'detected_at',now())
    WHERE package_id=p_package_id AND step_key=p_step_key
      AND status::text NOT IN ('blocked','done','skipped');

    UPDATE course_packages
    SET blocked_reason=COALESCE(blocked_reason,'')||' | NO_PROGRESS_TERMINAL@'||p_step_key
    WHERE id=p_package_id AND COALESCE(blocked_reason,'') NOT ILIKE '%NO_PROGRESS_TERMINAL@'||p_step_key||'%';

    INSERT INTO auto_heal_log(action_type,trigger_source,target_type,target_id,result_status,metadata)
    VALUES ('no_progress_terminal_block','fn_check_repair_no_progress_and_block','course_package',p_package_id::text,
      'blocked',jsonb_build_object('step_key',p_step_key,'runs',v_runs,'no_progress',v_no_progress));
    RETURN jsonb_build_object('blocked',true,'runs',v_runs,'no_progress',v_no_progress);
  END IF;
  RETURN jsonb_build_object('blocked',false,'runs',v_runs,'no_progress',v_no_progress);
END $$;