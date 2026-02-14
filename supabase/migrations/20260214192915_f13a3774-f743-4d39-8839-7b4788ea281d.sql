
-- ══════════════════════════════════════════════════════════════
-- Stufe 3+4: Self-Healing Runner + Hard Concurrency Slots
-- ══════════════════════════════════════════════════════════════

-- 1) Upgrade acquire_next_package_lease:
--    - Atomically clean expired leases before claiming
--    - Claims both 'queued' AND orphaned 'building' (expired/missing lease)
--    - Deterministic slot-aware claiming

CREATE OR REPLACE FUNCTION public.acquire_next_package_lease(
  p_runner_id text,
  p_lease_seconds integer DEFAULT 600
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_id uuid;
  v_active_count integer;
BEGIN
  -- Step 0: Atomically purge expired leases (self-healing, no watchdog needed)
  DELETE FROM public.package_leases WHERE lease_until < now();

  -- Step 1: Count ACTIVE leases (hard concurrency slots)
  SELECT COUNT(*) INTO v_active_count
  FROM public.package_leases
  WHERE lease_until > now();

  -- Step 2: If all 3 slots occupied, exit early
  IF v_active_count >= 3 THEN
    RETURN null;
  END IF;

  -- Step 3: Claim next package — queued OR orphaned building (no active lease)
  WITH next AS (
    SELECT cp.id
    FROM public.course_packages cp
    WHERE (
      cp.status = 'queued'
      OR (
        cp.status = 'building'
        AND NOT EXISTS (
          SELECT 1 FROM public.package_leases pl
          WHERE pl.package_id = cp.id
        )
      )
    )
    ORDER BY cp.queue_position ASC NULLS LAST, cp.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  SELECT id INTO v_pkg_id FROM next;

  IF v_pkg_id IS NULL THEN
    RETURN null;
  END IF;

  -- Step 4: Upsert lease
  INSERT INTO public.package_leases(package_id, runner_id, lease_until)
  VALUES (v_pkg_id, p_runner_id, now() + make_interval(secs => p_lease_seconds))
  ON CONFLICT (package_id) DO UPDATE
    SET runner_id = excluded.runner_id,
        lease_until = excluded.lease_until,
        renewed_at = now();

  -- Step 5: Ensure status = building
  UPDATE public.course_packages
  SET status = 'building'
  WHERE id = v_pkg_id;

  RETURN v_pkg_id;
END;
$function$;
