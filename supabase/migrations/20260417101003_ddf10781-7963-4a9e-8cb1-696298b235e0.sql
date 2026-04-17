
-- Heal v8.6.3: Hard-Fail-Reset + Full Pool Regenerate für Automobilkaufmann + Fachlagerist
DO $$
DECLARE
  v_user uuid := 'b0dbd616-9b93-47c8-83c5-39290130a6ea';
  v_targets uuid[] := ARRAY[
    '52cc076a-13ba-4f73-8202-b3f1164bba0f',  -- Automobilkaufmann
    'adce63f4-03ba-49ec-964c-c35e3984a591'   -- Fachlagerist
  ]::uuid[];
  v_id uuid; v_curr uuid; v_jobs int := 0;
BEGIN
  -- 1) Reset: Status + blocked_reason + Repair-Counter (no_effect_repairs_2h)
  UPDATE course_packages
  SET status = 'queued',
      blocked_reason = NULL,
      last_error = NULL,
      blocked_at = NULL,
      blocked_by = NULL,
      retry_count = 0,
      updated_at = now()
  WHERE id = ANY(v_targets);

  -- 2) Cancel alle alten failed/cancelled validate-jobs (Hard-Fail-Breaker freigeben)
  UPDATE job_queue
  SET status = 'cancelled',
      last_error = COALESCE(last_error,'') || ' | heal_v8.6.3: cleared for re-generate',
      updated_at = now()
  WHERE package_id = ANY(v_targets)
    AND status IN ('failed','pending','processing')
    AND job_type IN ('package_validate_exam_pool','package_repair_exam_pool_quality');

  -- 3) Full Re-Generate Job einreihen (nicht Repair, denn Repair konvergiert nicht)
  FOREACH v_id IN ARRAY v_targets LOOP
    SELECT curriculum_id INTO v_curr FROM course_packages WHERE id = v_id;
    INSERT INTO job_queue (job_type, package_id, status, payload, priority, created_at)
    VALUES ('package_generate_exam_pool', v_id, 'pending',
      jsonb_build_object(
        'source','heal_v8.6.3_hard_fail_recovery',
        'reason','exhausted_repair_attempts_full_regen',
        'curriculum_id', v_curr,
        'package_id', v_id,
        'force_full_regenerate', true
      ),
      2, now());
    v_jobs := v_jobs + 1;
  END LOOP;

  INSERT INTO admin_actions (action, scope, affected_ids, payload, user_id)
  VALUES ('heal_v8.6.3_hard_fail_recovery', 'pipeline_recovery', v_targets,
    jsonb_build_object(
      'jobs_queued', v_jobs,
      'strategy','reset_blocked → cancel_failed_validate → enqueue_full_regenerate',
      'targets', jsonb_build_array(
        jsonb_build_object('id','52cc076a','title','Automobilkaufmann','approved_q',60,'lfs_covered','1/12'),
        jsonb_build_object('id','adce63f4','title','Fachlagerist','approved_q',50,'lfs_covered','8/9')
      )
    ), v_user);
END $$;
