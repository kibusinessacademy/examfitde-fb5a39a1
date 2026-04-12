
-- 1) Update reaper to allow publish_failed packages
CREATE OR REPLACE FUNCTION public.fn_reap_non_building_pending_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cancelled int := 0;
  v_details jsonb[] := ARRAY[]::jsonb[];
  rec record;
BEGIN
  FOR rec IN
    SELECT jq.id, jq.job_type, jq.package_id, cp.status AS pkg_status
    FROM job_queue jq
    JOIN course_packages cp ON cp.id = jq.package_id
    LEFT JOIN job_type_policies jtp ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND cp.status NOT IN ('building', 'publish_failed')
      -- Respect policy whitelist
      AND NOT COALESCE(jtp.can_run_when_not_building, false)
      -- Only reap jobs older than 5 min to avoid race with status transitions
      AND jq.created_at < now() - interval '5 minutes'
    ORDER BY jq.created_at ASC
    LIMIT 200
  LOOP
    UPDATE job_queue
    SET status = 'cancelled',
        last_error = format('REAPED_NON_BUILDING: package status=%s', rec.pkg_status),
        updated_at = now()
    WHERE id = rec.id;

    v_cancelled := v_cancelled + 1;
    v_details := v_details || jsonb_build_object(
      'job_id', rec.id,
      'job_type', rec.job_type,
      'package_id', rec.package_id,
      'pkg_status', rec.pkg_status
    );
  END LOOP;

  IF v_cancelled > 0 THEN
    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail, metadata)
    VALUES (
      'non_building_job_reap',
      'fn_reap_non_building_pending_jobs',
      'job_queue',
      'applied',
      format('Cancelled %s pending jobs for non-building packages', v_cancelled),
      jsonb_build_object('cancelled', v_cancelled, 'details', to_jsonb(v_details))
    );
  END IF;

  RETURN jsonb_build_object(
    'cancelled', v_cancelled,
    'details', to_jsonb(v_details)
  );
END;
$$;

-- 2) Add job type policy for repair job
INSERT INTO job_type_policies (job_type, can_run_when_not_building)
VALUES ('package_repair_failed_lessons', true)
ON CONFLICT (job_type) DO UPDATE SET can_run_when_not_building = true;
