DO $$
DECLARE
  v_pkg_ids uuid[] := ARRAY[
    'd2000000-0015-4000-8000-000000000001'::uuid,
    'd2000000-0010-4000-8000-000000000001'::uuid,
    '091fb5ed-3bea-5e0b-840e-e07845a5ebc5'::uuid,
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b'::uuid,
    'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'::uuid,
    '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8'::uuid,
    '8f615dda-aafd-4c5e-8fc0-e9e15ad629c0'::uuid,
    'dd000001-0005-4000-8000-000000000001'::uuid
  ];
  v_status_changed int := 0;
  v_steps_reset int := 0;
  v_jobs_cancelled int := 0;
BEGIN
  UPDATE course_packages
     SET status = 'building', blocked_reason = NULL, updated_at = now()
   WHERE id = ANY(v_pkg_ids)
     AND status IN ('queued','quality_gate_failed','blocked');
  GET DIAGNOSTICS v_status_changed = ROW_COUNT;

  UPDATE job_queue
     SET status = 'cancelled',
         last_error = COALESCE(last_error,'') || ' | manual_forensic_blocked_heal_2026_04_28',
         updated_at = now()
   WHERE package_id = ANY(v_pkg_ids)
     AND status IN ('failed','processing','running')
     AND created_at < now() - interval '1 hour';
  GET DIAGNOSTICS v_jobs_cancelled = ROW_COUNT;

  UPDATE package_steps
     SET status = 'queued',
         attempts = 0,
         last_error = NULL,
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
           'reset_reason','manual_forensic_blocked_heal_2026_04_28',
           'reset_at', now()
         ),
         updated_at = now()
   WHERE package_id = ANY(v_pkg_ids)
     AND (
       status = 'failed'
       OR status = 'pending_enqueue'
       OR (status = 'queued'  AND last_error ILIKE ANY(ARRAY[
            '%CAUSALITY_BLOCKED%','%ORAL_EXAM_INCOMPLETE%','%HARD_FAIL%']))
       OR (status = 'skipped' AND last_error ILIKE ANY(ARRAY[
            '%HARD_FAIL_NO_CURRICULUM%','%post-condition failed%','%markStepDone verify MISMATCH%']))
     );
  GET DIAGNOSTICS v_steps_reset = ROW_COUNT;

  INSERT INTO auto_heal_log
    (trigger_source, action_type, target_type, target_id, input_params, result_status, result_detail, metadata)
  SELECT
    'manual_admin',
    'FORENSIC_BLOCKED_HEAL_2026_04_28',
    'course_package',
    pkg_id::text,
    jsonb_build_object('pkg_id', pkg_id),
    'success',
    'Bulk-Heal 11 Blocked-Pakete: status→building, steps reset, jobs cancelled',
    jsonb_build_object(
      'status_changed', v_status_changed,
      'steps_reset', v_steps_reset,
      'jobs_cancelled', v_jobs_cancelled
    )
  FROM unnest(v_pkg_ids) AS pkg_id;

  RAISE NOTICE 'Forensic-Heal: % packages → building, % steps reset, % jobs cancelled',
    v_status_changed, v_steps_reset, v_jobs_cancelled;
END $$;