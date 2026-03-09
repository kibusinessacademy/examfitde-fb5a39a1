
-- ═══════════════════════════════════════════════════════════════
-- Finish-First Strategy: WIP=1 + Market-Priority Ordering
-- ═══════════════════════════════════════════════════════════════

-- 1. Set WIP limit to 1 (finish one course before starting next)
INSERT INTO public.ops_pipeline_config (key, value) 
VALUES ('wip_limit', '"1"')
ON CONFLICT (key) DO UPDATE SET value = '"1"', updated_at = now();

-- 2. Update acquire RPC: default WIP=1, market-priority ordering
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
  v_porosity_pct int;
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

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'low_prio_porosity_pct';
    v_porosity_pct := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_porosity_pct := NULL; END;

  -- ── Finish-First defaults: WIP=1 ──
  v_max_slots := COALESCE(v_max_slots, 3);
  v_wip_limit := COALESCE(v_wip_limit, 1);  -- CHANGED: was 5, now 1
  v_priority_gate := COALESCE(v_priority_gate, 50);
  v_porosity_pct := COALESCE(v_porosity_pct, 10);

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

  -- Porous gate: configurable percentage
  IF v_top_incomplete > 0 AND v_porosity_pct > 0 THEN
    v_low_prio_chance := (random() < (v_porosity_pct / 100.0));
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > v_max_attempts THEN RETURN NULL; END IF;

    v_package_id := NULL;

    SELECT cp.id INTO v_package_id
    FROM public.course_packages cp
    WHERE
      (p_track IS NULL OR cp.track::text = p_track)
      AND (
        -- Zone A: Resume building packages (protect invested work)
        (cp.status = 'building' AND NOT EXISTS (
          SELECT 1 FROM public.package_leases pl WHERE pl.package_id = cp.id AND pl.lease_until > now()
        ))
        -- Zone B: Start new packages ONLY if under WIP limit
        OR (cp.status IN ('queued', 'failed') AND v_building_count < v_wip_limit)
      )
      AND cp.status NOT IN ('published', 'done', 'blocked', 'archived', 'draft')
      AND (
        v_top_incomplete = 0
        OR COALESCE(cp.priority, 999999) <= v_priority_gate
        OR v_low_prio_chance
        OR (cp.ready_since IS NOT NULL AND cp.ready_since < now() - interval '6 hours')
      )
    ORDER BY
      -- 1st: Always finish building packages first (Finish-First)
      CASE
        WHEN cp.status = 'building' THEN 0
        WHEN cp.status = 'queued'   THEN 1
        WHEN cp.status = 'failed'   THEN 2
        ELSE 3
      END,
      -- 2nd: Market priority with aging bonus
      GREATEST(3, COALESCE(cp.priority, 999999) - LEAST(3, COALESCE(floor(extract(epoch from (now() - cp.ready_since)) / 5400)::int, 0))) ASC,
      -- 3rd: FIFO within same priority
      cp.ready_since ASC NULLS LAST,
      cp.queue_position ASC NULLS LAST,
      cp.updated_at ASC NULLS LAST,
      cp.created_at ASC,
      cp.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_package_id IS NULL THEN RETURN NULL; END IF;

    UPDATE public.course_packages
    SET status = 'building', last_error = NULL, updated_at = now()
    WHERE id = v_package_id AND status IN ('queued', 'failed');

    SELECT status::text INTO v_effective_status FROM public.course_packages WHERE id = v_package_id;

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

-- Keep permissions
REVOKE ALL ON FUNCTION public.acquire_next_package_lease_v2(text, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.acquire_next_package_lease_v2(text, int, text) TO service_role;
