
-- ============================================================
-- Pipeline Hardening: Priority Queue + Heartbeat Reclaim + Adaptive Concurrency
-- ============================================================

-- 1) Priority Queue: Add priority column to course_packages
ALTER TABLE public.course_packages 
ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100;

COMMENT ON COLUMN public.course_packages.priority IS 
'Lower = higher priority. 10=manual/premium, 50=production, 100=default, 200=background/seeding';

CREATE INDEX IF NOT EXISTS idx_course_packages_priority_queue 
ON public.course_packages (priority ASC, queue_position ASC NULLS LAST, created_at ASC)
WHERE status IN ('queued', 'building');

-- 2) Ops Pipeline Config table for adaptive concurrency
CREATE TABLE IF NOT EXISTS public.ops_pipeline_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

ALTER TABLE public.ops_pipeline_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on ops_pipeline_config"
ON public.ops_pipeline_config FOR ALL
USING (true) WITH CHECK (true);

-- Seed default config
INSERT INTO public.ops_pipeline_config (key, value) VALUES
  ('max_concurrent_packages', '3'::jsonb),
  ('heartbeat_stale_seconds', '180'::jsonb),
  ('backpressure_threshold', '50'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3) Upgrade acquire_next_package_lease with:
--    a) Dynamic max_slots from ops_pipeline_config
--    b) Heartbeat staleness check for building reclaim
--    c) Priority-aware ordering
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease(
  p_runner_id text,
  p_lease_seconds integer DEFAULT 600
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg_id uuid;
  v_active_count integer;
  v_max_slots integer;
  v_heartbeat_stale_secs integer;
BEGIN
  -- Step 0: Purge expired leases (atomic self-healing)
  DELETE FROM public.package_leases WHERE lease_until < now();

  -- Step 1: Read dynamic config
  SELECT COALESCE((SELECT (value)::int FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages'), 3)
  INTO v_max_slots;
  
  SELECT COALESCE((SELECT (value)::int FROM public.ops_pipeline_config WHERE key = 'heartbeat_stale_seconds'), 180)
  INTO v_heartbeat_stale_secs;

  -- Step 2: Count active leases
  SELECT COUNT(*) INTO v_active_count
  FROM public.package_leases
  WHERE lease_until > now();

  -- Step 3: If all slots occupied, exit
  IF v_active_count >= v_max_slots THEN
    RETURN null;
  END IF;

  -- Step 4: Claim next package — queued OR orphaned building
  -- For building packages: require EITHER no lease OR stale heartbeat
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
        -- Heartbeat guard: only reclaim if last step heartbeat is stale
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.package_steps ps
            WHERE ps.package_id = cp.id 
            AND ps.status = 'running'
            AND ps.last_heartbeat_at > now() - make_interval(secs => v_heartbeat_stale_secs)
          )
        )
      )
    )
    ORDER BY cp.priority ASC, cp.queue_position ASC NULLS LAST, cp.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  SELECT id INTO v_pkg_id FROM next;

  IF v_pkg_id IS NULL THEN
    RETURN null;
  END IF;

  -- Step 5: Upsert lease
  INSERT INTO public.package_leases(package_id, runner_id, lease_until)
  VALUES (v_pkg_id, p_runner_id, now() + make_interval(secs => p_lease_seconds))
  ON CONFLICT (package_id) DO UPDATE
    SET runner_id = excluded.runner_id,
        lease_until = excluded.lease_until,
        renewed_at = now();

  -- Step 6: Ensure status = building
  UPDATE public.course_packages
  SET status = 'building'
  WHERE id = v_pkg_id;

  RETURN v_pkg_id;
END;
$$;
