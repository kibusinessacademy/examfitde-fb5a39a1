
-- Fix 1: Reset 4 stale processing jobs (no lease, stuck >5min)
UPDATE job_queue
SET status = 'pending',
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'auto_revived', true,
      'revived_at', now()::text,
      'revive_reason', 'stale_processing_no_lease'
    )
WHERE status = 'processing'
  AND updated_at < now() - interval '5 minutes';

-- Fix 2: Create permanent zombie-detection function
CREATE OR REPLACE FUNCTION public.fix_zombie_packages()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fixed_ids uuid[];
  fixed_count int;
BEGIN
  -- Find packages that are 'building' but have no active lease AND no pending/processing jobs
  WITH zombies AS (
    SELECT cp.id
    FROM course_packages cp
    WHERE cp.status = 'building'
      AND NOT EXISTS (
        SELECT 1 FROM package_leases pl
        WHERE pl.package_id = cp.id
          AND pl.lease_until > now()
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE (jq.payload->>'package_id')::uuid = cp.id
          AND jq.status IN ('pending', 'processing')
      )
      -- Only if stale for >10 minutes
      AND cp.updated_at < now() - interval '10 minutes'
  )
  UPDATE course_packages cp
  SET status = 'queued',
      last_error = NULL
  FROM zombies z
  WHERE cp.id = z.id
  RETURNING cp.id INTO fixed_ids;

  GET DIAGNOSTICS fixed_count = ROW_COUNT;

  -- Log if any were fixed
  IF fixed_count > 0 THEN
    INSERT INTO admin_notifications (title, body, category, severity, metadata)
    VALUES (
      'Zombie-Packages automatisch bereinigt',
      fixed_count || ' Pakete von building→queued zurückgesetzt (keine Lease, keine Jobs)',
      'pipeline',
      'warning',
      jsonb_build_object('fixed_count', fixed_count, 'fixed_ids', to_jsonb(fixed_ids))
    );
  END IF;

  RETURN jsonb_build_object(
    'fixed_count', fixed_count,
    'fixed_ids', COALESCE(to_jsonb(fixed_ids), '[]'::jsonb)
  );
END;
$$;
