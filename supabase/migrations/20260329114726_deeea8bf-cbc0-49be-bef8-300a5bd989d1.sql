
-- P1.1: Harden reset_false_active_packages — expand active job status check
CREATE OR REPLACE FUNCTION public.reset_false_active_packages()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  WITH resettable AS (
    SELECT bat.package_id
    FROM ops_build_activity_truth bat
    WHERE bat.status = 'building'
      AND bat.liveness_verdict IN ('false_active', 'no_activity')
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = bat.package_id
          AND jq.status IN ('pending', 'queued', 'processing', 'running')
      )
  ),
  reset AS (
    UPDATE course_packages cp
    SET status = 'queued',
        updated_at = now()
    FROM resettable r
    WHERE cp.id = r.package_id
    RETURNING cp.id
  )
  SELECT count(*) INTO v_count FROM reset;

  -- Release orphan leases (also expanded status check)
  DELETE FROM package_leases pl
  WHERE NOT EXISTS (
    SELECT 1 FROM job_queue jq
    WHERE jq.package_id = pl.package_id
      AND jq.status IN ('pending', 'queued', 'processing', 'running')
  )
  AND pl.package_id IN (
    SELECT package_id FROM ops_build_activity_truth
    WHERE liveness_verdict IN ('false_active', 'no_activity')
  );

  RETURN v_count;
END;
$$;

-- P1.2: Harden repair_exam_pool_quality — conditional done status
-- Update the RPC to return missing_lf_coverage so edge function can decide
-- (RPC already returns it, this is a no-op confirmation)

-- P1.3: Verify package_steps valid statuses — check if 'enqueued' exists
-- If not, we only use standard statuses: queued, running, done, failed, skipped
