DO $$
DECLARE
  v_pkgs uuid[] := ARRAY[
    '398573ab-bc9d-4fc9-9d8e-3607c24f3bf9'::uuid,
    '6348026b-86c9-4964-aee2-6f08ea99adae'::uuid
  ];
  v_cancelled int := 0;
  v_pkg uuid;
BEGIN
  WITH upd AS (
    UPDATE job_queue
    SET status='cancelled',
        last_error='manual_bypass: orphan_targeted_continuation_no_eligible_step',
        completed_at=now(),
        updated_at=now()
    WHERE package_id = ANY(v_pkgs)
      AND status IN ('pending','processing')
    RETURNING 1
  )
  SELECT count(*) INTO v_cancelled FROM upd;

  FOREACH v_pkg IN ARRAY v_pkgs LOOP
    INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, metadata, created_at)
    VALUES (v_pkg, 'package', 'manual_bypass_continuation_enqueue_failed', 'success',
      jsonb_build_object(
        'reason','Cancelled orphan targeted_competency_fill chain (all steps done/skipped, stale blueprint_variants caused UNIQUE conflicts).',
        'cancelled_jobs_total', v_cancelled,
        'reason_code','orphan_targeted_continuation_no_eligible_step'),
      now());
  END LOOP;

  RAISE NOTICE 'Cancelled % orphan jobs', v_cancelled;
END $$;