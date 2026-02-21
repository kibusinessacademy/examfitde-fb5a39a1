
-- 1) Create the missing auto_heal_building_zombies RPC
-- This resets packages stuck in 'building' without any active lease or running job
CREATE OR REPLACE FUNCTION public.auto_heal_building_zombies(zombie_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  healed integer := 0;
BEGIN
  WITH zombies AS (
    SELECT cp.id
    FROM course_packages cp
    WHERE cp.status = 'building'
      AND cp.updated_at < now() - (zombie_minutes || ' minutes')::interval
      -- No active lease
      AND NOT EXISTS (
        SELECT 1 FROM package_leases pl
        WHERE pl.package_id = cp.id
          AND pl.lease_until > now()
      )
      -- No pending/processing jobs
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = cp.id
          AND jq.status IN ('pending', 'processing')
      )
  ),
  updated AS (
    UPDATE course_packages
    SET status = 'queued',
        last_error = 'auto_heal: building zombie reset after ' || zombie_minutes || ' min without lease/jobs',
        updated_at = now()
    WHERE id IN (SELECT id FROM zombies)
    RETURNING id
  )
  SELECT count(*) INTO healed FROM updated;

  -- Also reset any running steps for these packages back to queued
  UPDATE package_steps ps
  SET status = 'queued',
      job_id = NULL,
      runner_id = NULL,
      started_at = NULL,
      last_error = 'auto_heal: zombie building reset'
  WHERE ps.package_id IN (
    SELECT cp.id FROM course_packages cp
    WHERE cp.status = 'queued'
      AND cp.last_error LIKE 'auto_heal: building zombie%'
      AND cp.updated_at > now() - interval '1 minute'
  )
  AND ps.status = 'running';

  RETURN healed;
END;
$$;

-- 2) Create ghost-state healing function
-- Transitions steps stuck in 'running' whose linked job is already done/failed
CREATE OR REPLACE FUNCTION public.heal_ghost_running_steps()
RETURNS TABLE(package_id uuid, step_key text, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ghost_steps AS (
    SELECT ps.package_id, ps.step_key, ps.job_id, jq.status AS j_status
    FROM package_steps ps
    JOIN job_queue jq ON jq.id = ps.job_id
    WHERE ps.status = 'running'
      AND jq.status IN ('completed', 'done', 'failed')
  ),
  healed_done AS (
    UPDATE package_steps ps2
    SET status = 'done',
        finished_at = now(),
        last_error = NULL
    FROM ghost_steps gs
    WHERE ps2.package_id = gs.package_id
      AND ps2.step_key = gs.step_key
      AND gs.j_status IN ('completed', 'done')
      -- Only if the job metadata indicates success
      AND EXISTS (
        SELECT 1 FROM job_queue jq2
        WHERE jq2.id = gs.job_id
          AND (jq2.result::jsonb->>'batch_complete')::boolean IS NOT FALSE
      )
    RETURNING ps2.package_id, ps2.step_key, 'done'::text AS job_status
  ),
  healed_failed AS (
    UPDATE package_steps ps3
    SET status = 'queued',
        job_id = NULL,
        runner_id = NULL,
        started_at = NULL,
        last_error = 'auto_heal: ghost step — job was ' || gs2.j_status
    FROM ghost_steps gs2
    WHERE ps3.package_id = gs2.package_id
      AND ps3.step_key = gs2.step_key
      AND (
        gs2.j_status = 'failed'
        OR NOT EXISTS (
          SELECT 1 FROM job_queue jq3
          WHERE jq3.id = gs2.job_id
            AND (jq3.result::jsonb->>'batch_complete')::boolean IS NOT FALSE
        )
      )
      -- Don't re-heal something we just healed as done
      AND NOT EXISTS (SELECT 1 FROM healed_done hd WHERE hd.package_id = ps3.package_id AND hd.step_key = ps3.step_key)
    RETURNING ps3.package_id, ps3.step_key, 'queued'::text AS job_status
  )
  SELECT * FROM healed_done
  UNION ALL
  SELECT * FROM healed_failed;
END;
$$;
