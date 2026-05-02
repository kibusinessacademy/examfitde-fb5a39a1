DO $$
DECLARE
  v_result jsonb;
  v_pkgs uuid[];
  v_step_errors_total int := 0;
  v_steps_reset_total int := 0;
  r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  WITH cancelled_loops AS (
    SELECT package_id
    FROM public.job_queue
    WHERE status = 'cancelled'
      AND updated_at > now() - interval '30 minutes'
      AND job_type IN ('package_repair_exam_pool_quality','package_run_integrity_check',
                       'package_quality_council','package_auto_publish')
    GROUP BY 1
  )
  SELECT array_agg(cp.id) INTO v_pkgs
  FROM public.course_packages cp
  JOIN cancelled_loops cl ON cl.package_id = cp.id
  WHERE cp.status IN ('building','blocked','queued')
    AND NOT cp.archived
    AND NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.status IN ('processing','running','pending','queued','retry_scheduled','batch_pending'));

  IF v_pkgs IS NULL OR array_length(v_pkgs,1) IS NULL THEN
    RAISE NOTICE 'No drift packages to test — v1.5 deploy verified only';
    RETURN;
  END IF;

  RAISE NOTICE 'v1.5 live test against % drift packages', array_length(v_pkgs,1);

  v_result := public.admin_heal_pending_enqueue_drift(v_pkgs, 'v1_5_live_test', false);

  -- Aggregiere Resultate
  FOR r IN SELECT * FROM jsonb_array_elements(v_result->'results')
  LOOP
    v_step_errors_total := v_step_errors_total + COALESCE(jsonb_array_length(r->'step_errors'), 0);
    v_steps_reset_total := v_steps_reset_total + COALESCE(jsonb_array_length(r->'steps_reset'), 0);
  END LOOP;

  RAISE NOTICE 'v1.5 SUMMARY: pkgs=%, steps_reset=%, step_errors=%',
    array_length(v_pkgs,1), v_steps_reset_total, v_step_errors_total;
  RAISE NOTICE 'v1.5 FULL: %', v_result::text;
END $$;