DO $$
DECLARE
  v_pkg uuid;
  v_promoted int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_eligible uuid[];
  v_wip int;
BEGIN
  SELECT COUNT(*) INTO v_wip FROM course_packages WHERE status='building' AND archived=false;
  IF v_wip >= 60 THEN
    RAISE NOTICE 'wip_cap_reached: %', v_wip;
    RETURN;
  END IF;

  SELECT array_agg(cp.id ORDER BY cp.title) INTO v_eligible
  FROM (
    SELECT cp.id, cp.title FROM course_packages cp
    JOIN v_learning_integrity_audit a ON a.package_id = cp.id
    WHERE cp.status = 'queued' AND a.gate_no_lessons = true AND cp.archived = false
      AND COALESCE((cp.feature_flags->'bronze'->>'locked')::boolean, false) = false
      AND NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('pending','queued','processing'))
      AND NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id = cp.id AND jq.status = 'failed' AND jq.created_at > now() - interval '6 hours')
    ORDER BY cp.title
    LIMIT LEAST(27, GREATEST(0, 60 - v_wip))
  ) cp;

  IF v_eligible IS NULL THEN
    RAISE NOTICE 'no_eligible';
    RETURN;
  END IF;

  FOREACH v_pkg IN ARRAY v_eligible LOOP
    BEGIN
      PERFORM public.admin_nudge_atomic_trigger(v_pkg, false);
      v_promoted := v_promoted + 1;
      v_results := v_results || jsonb_build_object('package_id', v_pkg, 'status', 'promoted');
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object('package_id', v_pkg, 'status', 'skipped', 'error', SQLERRM);
    END;
  END LOOP;

  INSERT INTO auto_heal_log(target_type, action_type, result_status, metadata)
  VALUES ('system','lxi_queued_no_lessons_pushed',
    CASE WHEN v_promoted > 0 THEN 'success' ELSE 'partial' END,
    jsonb_build_object('promoted', v_promoted, 'skipped', v_skipped, 'wip_before', v_wip, 'results', v_results, 'invoked_via', 'migration_bypass'));

  RAISE NOTICE 'promoted=% skipped=% wip_before=%', v_promoted, v_skipped, v_wip;
END $$;