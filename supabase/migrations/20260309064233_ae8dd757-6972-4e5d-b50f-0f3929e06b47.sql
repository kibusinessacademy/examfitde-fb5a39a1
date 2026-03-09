
-- Replace guardian_fail_package_if_stale with priority-aware, grace-aware, queued-step-aware version
CREATE OR REPLACE FUNCTION public.guardian_fail_package_if_stale(
  p_package_id uuid,
  p_min_age_minutes int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_age_minutes int;
  v_priority int;
  v_active_leases int;
  v_active_jobs int;
  v_active_steps int;
  v_queued_steps int;
  v_last_step_done_age_min int;
  v_higher_prio_building int;
  v_dynamic_threshold int;
  v_rows_updated int := 0;
  v_applied boolean := false;
  v_reason text := 'guarded';
BEGIN
  -- 1. Package age & priority
  SELECT
    COALESCE(floor(extract(epoch from (now() - cp.updated_at))/60)::int, 0),
    COALESCE((cp.priority)::int, 5)
  INTO v_age_minutes, v_priority
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF v_age_minutes IS NULL THEN
    RETURN jsonb_build_object('error', 'package not found', 'pkg_id', p_package_id);
  END IF;

  -- 2. Active leases
  SELECT count(*)::int INTO v_active_leases
  FROM package_leases pl
  WHERE pl.package_id = p_package_id AND pl.lease_until > now();

  -- 3. Active jobs (pending/processing)
  SELECT count(*)::int INTO v_active_jobs
  FROM job_queue jq
  WHERE jq.payload->>'package_id' = p_package_id::text
    AND jq.status IN ('pending', 'processing');

  -- 4. Active steps (running/enqueued)
  SELECT count(*)::int INTO v_active_steps
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status IN ('running', 'enqueued');

  -- 5. Queued steps awaiting scheduling
  SELECT count(*)::int INTO v_queued_steps
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status = 'queued';

  -- 6. Grace window: minutes since last step completed
  SELECT COALESCE(
    floor(extract(epoch from (now() - max(ps.finished_at)))/60)::int,
    999
  ) INTO v_last_step_done_age_min
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status = 'done'
    AND ps.finished_at IS NOT NULL;

  -- 7. Count higher-priority packages currently building (scheduler pressure)
  SELECT count(*)::int INTO v_higher_prio_building
  FROM course_packages cp2
  WHERE cp2.status = 'building'
    AND cp2.id <> p_package_id
    AND COALESCE(cp2.priority, 5) < v_priority;

  -- 8. Compute dynamic threshold based on priority + backlog
  -- Base thresholds by priority tier
  v_dynamic_threshold := CASE
    WHEN v_priority <= 3  THEN 30    -- high prio: 30 min
    WHEN v_priority <= 5  THEN 60    -- mid prio: 1h
    WHEN v_priority <= 8  THEN 120   -- low prio: 2h
    ELSE                       360   -- backlog: 6h
  END;

  -- Backlog multiplier: if many higher-prio packages are active, be more tolerant
  IF v_higher_prio_building >= 5 THEN
    v_dynamic_threshold := v_dynamic_threshold * 2;
  ELSIF v_higher_prio_building >= 2 THEN
    v_dynamic_threshold := (v_dynamic_threshold * 3) / 2;  -- 1.5x
  END IF;

  -- Override caller's min_age with dynamic threshold (use the larger of the two)
  IF p_min_age_minutes > v_dynamic_threshold THEN
    v_dynamic_threshold := p_min_age_minutes;
  END IF;

  -- 9. Guard: queued steps = legitimate scheduling wait, NOT a dead build
  -- Only fail if no queued steps remain, OR threshold is exceeded even with queued steps
  -- Grace: if a step completed recently (< threshold/2), don't kill — runner may be claiming next
  IF v_active_leases > 0 OR v_active_jobs > 0 OR v_active_steps > 0 THEN
    v_reason := 'guarded_active_work';
  ELSIF v_last_step_done_age_min < GREATEST(v_dynamic_threshold / 2, 15) THEN
    v_reason := 'guarded_recent_step_completion';
  ELSIF v_queued_steps > 0 AND v_age_minutes < v_dynamic_threshold THEN
    v_reason := 'guarded_queued_steps_within_threshold';
  ELSIF v_age_minutes < v_dynamic_threshold THEN
    v_reason := 'guarded_within_threshold';
  ELSE
    -- All guards exhausted: this is genuinely stale
    UPDATE course_packages
    SET status = 'failed', updated_at = now()
    WHERE id = p_package_id AND status = 'building';

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    v_applied := (v_rows_updated > 0);
    v_reason := 'stale_build_priority_aware';
  END IF;

  RETURN jsonb_build_object(
    'pkg_id', p_package_id,
    'age_min', v_age_minutes,
    'priority', v_priority,
    'dynamic_threshold_min', v_dynamic_threshold,
    'active_leases', v_active_leases,
    'active_jobs', v_active_jobs,
    'active_steps', v_active_steps,
    'queued_steps', v_queued_steps,
    'last_step_done_age_min', v_last_step_done_age_min,
    'higher_prio_building', v_higher_prio_building,
    'applied', v_applied,
    'reason', v_reason
  );
END;
$$;
