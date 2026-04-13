
-- =========================================================
-- FIX 1: heal_non_building_packages must respect intentional_pause
-- =========================================================
CREATE OR REPLACE FUNCTION public.heal_non_building_packages(p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed jsonb := '[]'::jsonb;
  v_pkg record;
  v_first_open_step record;
  v_now timestamptz := now();
  v_active_jobs int;
BEGIN
  FOR v_pkg IN
    SELECT cp.id AS package_id, cp.status, cp.blocked_reason, cp.last_error,
           cp.build_progress, cp.integrity_passed, cp.council_approved
    FROM course_packages cp
    WHERE cp.status IN ('queued', 'blocked', 'quality_gate_failed')
      AND cp.status NOT IN ('done', 'published', 'cancelled')
      -- Must have at least one non-done step (not terminal)
      AND EXISTS (
        SELECT 1 FROM package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.status NOT IN ('done', 'skipped')
      )
      -- CRITICAL: Never unblock intentional_pause packages
      AND COALESCE(cp.blocked_reason, '') NOT ILIKE '%intentional_pause%'
      -- Skip packages with legitimate hard blocks (fixed OR→AND logic)
      AND COALESCE(cp.blocked_reason, '') NOT LIKE '%HARD_FAIL%'
      AND COALESCE(cp.blocked_reason, '') NOT LIKE '%COUNCIL_REJECTED%'
      -- Must not have a very recent block (< 30 min = might be intentional)
      AND cp.updated_at < v_now - interval '30 minutes'
    ORDER BY cp.build_progress DESC
    LIMIT p_limit
  LOOP
    -- Check for active jobs — if jobs are running, package isn't truly stuck
    SELECT count(*) INTO v_active_jobs
    FROM job_queue jq
    WHERE jq.package_id = v_pkg.package_id
      AND jq.status IN ('pending', 'queued', 'processing');

    -- Find first actionable open step (by DAG order approximation via created_at)
    SELECT ps.* INTO v_first_open_step
    FROM package_steps ps
    WHERE ps.package_id = v_pkg.package_id
      AND ps.status NOT IN ('done', 'skipped')
    ORDER BY ps.created_at ASC
    LIMIT 1;

    IF v_first_open_step IS NULL THEN
      CONTINUE;
    END IF;

    -- Normalize package status to building
    UPDATE course_packages
    SET status = 'building',
        blocked_reason = NULL,
        last_error = NULL,
        stuck_reason = NULL,
        updated_at = v_now
    WHERE id = v_pkg.package_id;

    -- If no active jobs and first step is failed/stuck, requeue it
    IF v_active_jobs = 0 AND v_first_open_step.status IN ('failed', 'queued') THEN
      UPDATE package_steps
      SET status = 'queued',
          started_at = NULL,
          finished_at = NULL,
          last_error = NULL,
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'heal_non_building_requeued', true,
            'heal_at', v_now::text,
            'heal_prev_pkg_status', v_pkg.status,
            'heal_prev_blocked_reason', v_pkg.blocked_reason
          )
      WHERE id = v_first_open_step.id;
    END IF;

    -- Cancel stale failed jobs for this package (> 2h old)
    UPDATE job_queue
    SET status = 'cancelled',
        completed_at = v_now,
        updated_at = v_now,
        last_error = '[HEAL_NON_BUILDING] ' || v_now::text || ' cancelled for recovery'
    WHERE package_id = v_pkg.package_id
      AND status = 'failed'
      AND updated_at < v_now - interval '2 hours';

    v_healed := v_healed || jsonb_build_object(
      'package_id', v_pkg.package_id,
      'prev_status', v_pkg.status,
      'prev_blocked_reason', v_pkg.blocked_reason,
      'first_open_step', v_first_open_step.step_key,
      'active_jobs', v_active_jobs,
      'action', 'normalized_to_building'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'healed_count', jsonb_array_length(v_healed),
    'healed', v_healed,
    'ts', v_now
  );
END;
$$;

-- =========================================================
-- FIX 2: Re-block all packages that should not be building
-- Keep: packages with >= 40% progress OR Personal OR the 3 explicit Prio-1 unblocked courses
-- Block: everything else
-- =========================================================

-- Delete pending jobs for packages about to be blocked
DELETE FROM job_queue
WHERE status = 'pending'
  AND package_id IN (
    SELECT id FROM course_packages
    WHERE status = 'building'
      AND build_progress < 40
      AND title NOT ILIKE '%personal%'
      AND id NOT IN (
        '180c24a9-eba7-4159-ada8-140cee76f947', -- IT-System-Elektroniker
        'ba96f6d9-c638-4bf3-aaca-3465ac363e8b', -- Finanzanlagenvermittler §34f
        '3e070545-c555-417a-a047-c7541ebb2a7c'  -- Immobiliardarlehensvermittler §34i
      )
  );

-- Block the packages
UPDATE course_packages
SET status = 'blocked',
    blocked_reason = 'intentional_pause',
    last_error = 'ADMIN_PAUSE: WIP overflow fix, build < 40%, ' || now()::text,
    updated_at = now()
WHERE status = 'building'
  AND build_progress < 40
  AND title NOT ILIKE '%personal%'
  AND id NOT IN (
    '180c24a9-eba7-4159-ada8-140cee76f947',
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b',
    '3e070545-c555-417a-a047-c7541ebb2a7c'
  );
