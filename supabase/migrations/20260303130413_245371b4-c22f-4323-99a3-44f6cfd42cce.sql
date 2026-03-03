-- FIX: acquire_next_package_lease_v2 — ops_pipeline_config.value is JSONB, not text
-- The cast `nullif(value, '')::int` fails on jsonb. Use `(value#>>'{}')::int` instead.

CREATE OR REPLACE FUNCTION public.acquire_next_package_lease_v2(
  p_runner_id text,
  p_lease_seconds integer DEFAULT 120,
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
  v_top30_incomplete int;
  v_effective_status text;
  v_raw_val text;
BEGIN
  -- ── Config (FIXED: jsonb → text via #>>'{}') ──────────────
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

  v_max_slots := coalesce(v_max_slots, 5);
  v_wip_limit := coalesce(v_wip_limit, 5);

  -- ── Hygiene: cleanup expired leases ────────────────────────
  DELETE FROM public.package_leases
  WHERE lease_until < now();

  -- ── Global hard cap: active leases ─────────────────────────
  SELECT count(*)
  INTO v_active_leases
  FROM public.package_leases
  WHERE lease_until > now();

  IF v_active_leases >= v_max_slots THEN
    RETURN NULL;
  END IF;

  -- ── Track-aware WIP count ──────────────────────────────────
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

  -- ── Priority guard ─────────────────────────────────────────
  SELECT count(*)
  INTO v_top30_incomplete
  FROM public.course_packages
  WHERE priority <= 10
    AND status NOT IN ('published', 'done', 'blocked', 'archived', 'draft');

  -- ── Pick next candidate ────────────────────────────────────
  SELECT cp.id
  INTO v_package_id
  FROM public.course_packages cp
  WHERE
    (p_track IS NULL OR cp.track::text = p_track)
    AND
    (
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
    AND (v_top30_incomplete = 0 OR cp.priority <= 10)
    AND cp.status NOT IN ('published', 'done', 'blocked', 'archived', 'draft')
  ORDER BY
    CASE
      WHEN cp.status = 'building' THEN 0
      WHEN cp.status = 'queued'   THEN 1
      WHEN cp.status = 'failed'   THEN 2
      ELSE 3
    END,
    cp.priority ASC NULLS LAST,
    cp.queue_position ASC NULLS LAST,
    cp.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_package_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- ── Promote QUEUED/FAILED -> BUILDING ──────────────────────
  UPDATE public.course_packages
  SET status = 'building',
      last_error = NULL,
      updated_at = now()
  WHERE id = v_package_id
    AND status IN ('queued', 'failed');

  SELECT status::text
  INTO v_effective_status
  FROM public.course_packages
  WHERE id = v_package_id;

  IF v_effective_status <> 'building' THEN
    RETURN NULL;
  END IF;

  -- ── Upsert lease ───────────────────────────────────────────
  INSERT INTO public.package_leases (package_id, runner_id, lease_until)
  VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
  ON CONFLICT (package_id) DO UPDATE
  SET runner_id  = EXCLUDED.runner_id,
      lease_until = EXCLUDED.lease_until;

  RETURN v_package_id;
END;
$$;