
-- ============================================================
-- 1. WIP Enforcement: Demote excess building packages
-- ============================================================
CREATE OR REPLACE FUNCTION public.ops_enforce_wip_limit(
  p_wip_cap integer DEFAULT 13
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_building_count integer;
  v_excess integer;
  v_demoted_ids uuid[];
  v_row record;
BEGIN
  -- Count current building packages
  SELECT count(*) INTO v_building_count
  FROM course_packages WHERE status = 'building';

  v_excess := v_building_count - p_wip_cap;

  IF v_excess <= 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'building_count', v_building_count,
      'wip_cap', p_wip_cap,
      'demoted', 0,
      'message', 'WIP within limits'
    );
  END IF;

  -- Select packages to demote: lowest priority first (highest number),
  -- then lowest build_progress, then oldest updated_at
  v_demoted_ids := ARRAY(
    SELECT id FROM course_packages
    WHERE status = 'building'
    ORDER BY priority DESC NULLS LAST, build_progress ASC, updated_at ASC
    LIMIT v_excess
  );

  -- Demote each package
  FOR v_row IN
    SELECT id, priority, build_progress
    FROM course_packages
    WHERE id = ANY(v_demoted_ids)
  LOOP
    -- Set back to queued
    UPDATE course_packages
    SET status = 'queued',
        updated_at = now()
    WHERE id = v_row.id;

    -- Cancel associated pending/failed jobs
    UPDATE job_queue
    SET status = 'cancelled',
        last_error = 'WIP_ENFORCEMENT: demoted to queued',
        updated_at = now()
    WHERE package_id = v_row.id
      AND status IN ('pending', 'failed');

    -- Release any active leases
    UPDATE system_execution_leases
    SET status = 'released',
        released_at = now(),
        updated_at = now()
    WHERE lease_key LIKE '%' || v_row.id::text || '%'
      AND status = 'active';

    -- Audit log
    INSERT INTO admin_actions (action, scope, affected_ids, payload, after_state)
    VALUES (
      'wip_enforcement_demote',
      'system',
      ARRAY[v_row.id::text],
      jsonb_build_object(
        'priority', v_row.priority,
        'build_progress', v_row.build_progress,
        'wip_cap', p_wip_cap,
        'building_count', v_building_count
      ),
      jsonb_build_object('new_status', 'queued')
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'building_count', v_building_count,
    'wip_cap', p_wip_cap,
    'demoted', array_length(v_demoted_ids, 1),
    'demoted_ids', to_jsonb(v_demoted_ids)
  );
END;
$$;

-- ============================================================
-- 2. Orphan Reaper: Clean failed jobs for non-building packages
-- ============================================================
CREATE OR REPLACE FUNCTION public.ops_reap_failed_orphan_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH orphans AS (
    DELETE FROM job_queue jq
    USING course_packages cp
    WHERE jq.package_id = cp.id
      AND jq.status = 'failed'
      AND cp.status NOT IN ('building')
      AND jq.updated_at < now() - interval '30 minutes'
    RETURNING jq.id
  )
  SELECT count(*) INTO v_count FROM orphans;

  RETURN jsonb_build_object('ok', true, 'reaped_failed_orphans', v_count);
END;
$$;

-- ============================================================
-- 3. Orphan Reaper: Clean duplicate pending jobs
-- ============================================================
CREATE OR REPLACE FUNCTION public.ops_reap_duplicate_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY package_id, job_type
             ORDER BY created_at ASC
           ) as rn
    FROM job_queue
    WHERE status = 'pending'
  ),
  dupes AS (
    DELETE FROM job_queue
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM dupes;

  RETURN jsonb_build_object('ok', true, 'reaped_duplicates', v_count);
END;
$$;
