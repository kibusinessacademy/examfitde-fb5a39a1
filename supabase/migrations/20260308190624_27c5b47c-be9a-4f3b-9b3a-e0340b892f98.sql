-- Fix 1: Block the unenriched Wirtschaftsfachwirt that poisons the acquire queue
UPDATE public.course_packages 
SET status = 'blocked', 
    blocked_reason = 'ENRICHMENT_GATE: 0/9 competencies enriched. Blocking to unpoison acquire queue.',
    updated_at = now()
WHERE id = '2d0002fa-907c-462b-bca4-299fa6358284' 
  AND status = 'queued';

-- Fix 2: Replace acquire_next_package_lease_v2 with retry loop 
-- to handle trigger-reverted rows (enrichment gate silently reverts building→queued)
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
  v_max_attempts int := 5;  -- Try up to 5 candidates before giving up
BEGIN
  BEGIN
    SELECT value#>>'{}' INTO v_raw_val
    FROM public.ops_pipeline_config
    WHERE key = 'max_concurrent_packages';
    v_max_slots := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN
    v_max_slots := NULL;
  END;

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val
    FROM public.ops_pipeline_config
    WHERE key = 'wip_limit';
    v_wip_limit := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN
    v_wip_limit := NULL;
  END;

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val
    FROM public.ops_pipeline_config
    WHERE key = 'priority_gate_rank';
    v_priority_gate := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN
    v_priority_gate := NULL;
  END;

  v_max_slots := COALESCE(v_max_slots, 5);
  v_wip_limit := COALESCE(v_wip_limit, 5);
  v_priority_gate := COALESCE(v_priority_gate, 50);

  DELETE FROM public.package_leases
  WHERE lease_until < now();

  SELECT count(*)
  INTO v_active_leases
  FROM public.package_leases
  WHERE lease_until > now();

  IF v_active_leases >= v_max_slots THEN
    RETURN NULL;
  END IF;

  IF p_track IS NULL THEN
    SELECT count(*)
    INTO v_building_count
    FROM public.course_packages
    WHERE status = 'building';
  ELSE
    SELECT count(*)
    INTO v_building_count
    FROM public.course_packages
    WHERE status = 'building'
      AND track::text = p_track;
  END IF;

  SELECT count(*)
  INTO v_top_incomplete
  FROM public.course_packages
  WHERE COALESCE(priority, 999999) <= v_priority_gate
    AND status NOT IN ('published', 'done', 'blocked', 'archived', 'draft');

  -- Retry loop: if a trigger silently reverts the status (e.g. enrichment gate),
  -- try the next candidate instead of returning null immediately.
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > v_max_attempts THEN
      RETURN NULL;
    END IF;

    v_package_id := NULL;

    SELECT cp.id
    INTO v_package_id
    FROM public.course_packages cp
    WHERE
      (p_track IS NULL OR cp.track::text = p_track)
      AND (
        (
          cp.status = 'building'
          AND NOT EXISTS (
            SELECT 1
            FROM public.package_leases pl
            WHERE pl.package_id = cp.id
              AND pl.lease_until > now()
          )
        )
        OR
        (
          cp.status IN ('queued', 'failed')
          AND v_building_count < v_wip_limit
        )
      )
      AND cp.status NOT IN ('published', 'done', 'blocked', 'archived', 'draft')
      AND (
        v_top_incomplete = 0
        OR COALESCE(cp.priority, 999999) <= v_priority_gate
      )
    ORDER BY
      CASE
        WHEN cp.status = 'building' THEN 0
        WHEN cp.status = 'queued'   THEN 1
        WHEN cp.status = 'failed'   THEN 2
        ELSE 3
      END,
      COALESCE(cp.priority, 999999) ASC,
      cp.queue_position ASC NULLS LAST,
      cp.updated_at ASC NULLS LAST,
      cp.created_at ASC,
      cp.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_package_id IS NULL THEN
      RETURN NULL;  -- No more candidates at all
    END IF;

    -- Try to promote to building
    UPDATE public.course_packages
    SET status = 'building',
        last_error = NULL,
        updated_at = now()
    WHERE id = v_package_id
      AND status IN ('queued', 'failed');

    -- Check if the promotion stuck (triggers may silently revert)
    SELECT status::text
    INTO v_effective_status
    FROM public.course_packages
    WHERE id = v_package_id;

    IF v_effective_status = 'building' THEN
      -- Success! Create lease and return
      INSERT INTO public.package_leases (package_id, runner_id, lease_until)
      VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
      ON CONFLICT (package_id) DO UPDATE
      SET runner_id = EXCLUDED.runner_id,
          lease_until = EXCLUDED.lease_until;

      RETURN v_package_id;
    END IF;

    -- Trigger reverted the status — this package can't be built yet.
    -- Loop will try the next candidate (SKIP LOCKED skips this one now).
    -- Note: the row is still locked by our FOR UPDATE, so next iteration
    -- will naturally skip it via SKIP LOCKED within this transaction.
  END LOOP;
END;
$$;