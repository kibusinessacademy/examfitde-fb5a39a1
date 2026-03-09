
-- ═══════════════════════════════════════════════════════════════
-- Anti-Starvation Patch: ready_since + Fair Acquire + Aging
-- ═══════════════════════════════════════════════════════════════

-- 1. Add ready_since column (stable timestamp for aging calculations)
ALTER TABLE public.course_packages 
ADD COLUMN IF NOT EXISTS ready_since timestamptz;

-- Backfill: set ready_since for existing queued/building packages
UPDATE public.course_packages
SET ready_since = COALESCE(
  -- For building: use earliest step start as proxy
  (SELECT min(started_at) FROM package_steps ps WHERE ps.package_id = course_packages.id AND ps.started_at IS NOT NULL),
  created_at
)
WHERE status IN ('queued', 'building', 'failed')
  AND ready_since IS NULL;

-- Auto-set ready_since on status transitions via trigger
CREATE OR REPLACE FUNCTION trg_set_ready_since()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Set ready_since when entering queued (if not already set)
  IF NEW.status IN ('queued', 'building') AND OLD.status NOT IN ('queued', 'building') THEN
    IF NEW.ready_since IS NULL THEN
      NEW.ready_since := now();
    END IF;
  END IF;
  -- Clear ready_since when leaving the pipeline
  IF NEW.status IN ('published', 'done', 'archived', 'cancelled', 'blocked') THEN
    NEW.ready_since := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_course_packages_ready_since ON public.course_packages;
CREATE TRIGGER trg_course_packages_ready_since
  BEFORE UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_ready_since();

-- 2. Replace acquire RPC with anti-starvation version
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease_v2(
  p_runner_id text,
  p_lease_seconds int DEFAULT 120,
  p_track text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package_id uuid;
  v_max_slots int;
  v_active_leases int;
  v_wip_limit int;
  v_building_count int;
  v_top_incomplete int;
  v_effective_status text;
  v_raw_val text;
  v_priority_gate int;
  v_attempt int := 0;
  v_max_attempts int := 8;
  v_low_prio_chance boolean := false;
BEGIN
  -- ── Read config ──
  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages';
    v_max_slots := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_max_slots := NULL; END;

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'wip_limit';
    v_wip_limit := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_wip_limit := NULL; END;

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'priority_gate_rank';
    v_priority_gate := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_priority_gate := NULL; END;

  v_max_slots := COALESCE(v_max_slots, 5);
  v_wip_limit := COALESCE(v_wip_limit, 5);
  v_priority_gate := COALESCE(v_priority_gate, 50);

  -- ── Cleanup expired leases ──
  DELETE FROM public.package_leases WHERE lease_until < now();

  SELECT count(*) INTO v_active_leases FROM public.package_leases WHERE lease_until > now();
  IF v_active_leases >= v_max_slots THEN RETURN NULL; END IF;

  IF p_track IS NULL THEN
    SELECT count(*) INTO v_building_count FROM public.course_packages WHERE status = 'building';
  ELSE
    SELECT count(*) INTO v_building_count FROM public.course_packages WHERE status = 'building' AND track::text = p_track;
  END IF;

  SELECT count(*) INTO v_top_incomplete
  FROM public.course_packages
  WHERE COALESCE(priority, 999999) <= v_priority_gate
    AND status NOT IN ('published', 'done', 'blocked', 'archived', 'draft');

  -- ── Porous Gate: ~10% chance to let a low-prio package through ──
  -- Also always allow if the low-prio package has been waiting > 6 hours
  IF v_top_incomplete > 0 THEN
    -- Random 10% porosity
    v_low_prio_chance := (random() < 0.10);
  END IF;

  -- ── Acquisition loop ──
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > v_max_attempts THEN RETURN NULL; END IF;

    v_package_id := NULL;

    SELECT cp.id INTO v_package_id
    FROM public.course_packages cp
    WHERE
      (p_track IS NULL OR cp.track::text = p_track)
      AND (
        -- Zone A: Resumable building packages (no active lease) — HIGHEST priority
        (
          cp.status = 'building'
          AND NOT EXISTS (
            SELECT 1 FROM public.package_leases pl
            WHERE pl.package_id = cp.id AND pl.lease_until > now()
          )
        )
        OR
        -- Zone B: New queued/failed packages (within WIP limit)
        (
          cp.status IN ('queued', 'failed')
          AND v_building_count < v_wip_limit
        )
      )
      AND cp.status NOT IN ('published', 'done', 'blocked', 'archived', 'draft')
      AND (
        -- Priority gate logic with porosity
        v_top_incomplete = 0                                    -- No top-prio work → everything eligible
        OR COALESCE(cp.priority, 999999) <= v_priority_gate     -- Within gate
        OR v_low_prio_chance                                    -- 10% porosity
        OR (                                                    -- Aging override: waited > 6h
          cp.ready_since IS NOT NULL
          AND cp.ready_since < now() - interval '6 hours'
        )
      )
    ORDER BY
      -- 1. Resumable building before new queued (protect invested work)
      CASE
        WHEN cp.status = 'building' THEN 0
        WHEN cp.status = 'queued'   THEN 1
        WHEN cp.status = 'failed'   THEN 2
        ELSE 3
      END,
      -- 2. Effective priority with aging bonus
      -- Every 90 min waiting reduces effective priority by 1 (capped at -3)
      GREATEST(
        3,
        COALESCE(cp.priority, 999999)
        - LEAST(3, COALESCE(
          floor(extract(epoch from (now() - cp.ready_since)) / 5400)::int,
          0
        ))
      ) ASC,
      -- 3. FIFO within same effective priority
      cp.ready_since ASC NULLS LAST,
      cp.queue_position ASC NULLS LAST,
      cp.updated_at ASC NULLS LAST,
      cp.created_at ASC,
      cp.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_package_id IS NULL THEN RETURN NULL; END IF;

    -- Try to promote to building
    UPDATE public.course_packages
    SET status = 'building', last_error = NULL, updated_at = now()
    WHERE id = v_package_id AND status IN ('queued', 'failed');

    -- Check if promotion stuck (triggers may silently revert)
    SELECT status::text INTO v_effective_status
    FROM public.course_packages WHERE id = v_package_id;

    IF v_effective_status = 'building' THEN
      INSERT INTO public.package_leases (package_id, runner_id, lease_until)
      VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
      ON CONFLICT (package_id) DO UPDATE
      SET runner_id = EXCLUDED.runner_id, lease_until = EXCLUDED.lease_until;

      RETURN v_package_id;
    END IF;
  END LOOP;
END;
$$;

-- 3. Add config for reserved low-prio slot
INSERT INTO public.ops_pipeline_config (key, value, updated_at)
VALUES ('low_prio_porosity_pct', '10', now())
ON CONFLICT (key) DO NOTHING;
