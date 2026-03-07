
-- =========================================================
-- PRIORITY + DUPLICATE SSOT v2
-- =========================================================

-- 1) Hard uniqueness: one course per curriculum
CREATE UNIQUE INDEX IF NOT EXISTS uq_courses_curriculum_id
ON public.courses (curriculum_id)
WHERE curriculum_id IS NOT NULL;

-- 2) Active package uniqueness erweitern:
--    planning/queued/building/failed/published/draft sollen nicht mehrfach parallel sichtbar sein
DROP INDEX IF EXISTS public.uniq_active_package_per_curriculum;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_visible_package_per_curriculum
ON public.course_packages (curriculum_id)
WHERE curriculum_id IS NOT NULL
  AND status IN ('planning', 'queued', 'building', 'failed', 'published', 'draft');

-- 3) Echte feinere Priorität aus market rank ableiten
CREATE OR REPLACE VIEW public.v_beruf_priority AS
SELECT
  b.id AS beruf_id,
  b.bezeichnung_kurz,
  b.bibb_id,

  bmd.occupation_name,
  bmd.azubi_count,
  bmd.demand_percentile,
  bmd.market_score,
  bmd.tier,
  bmd.priority_rank,
  bmd.est_penetration_pct,
  bmd.est_arpu_eur,
  bmd.est_annual_revenue_eur,
  bmd.is_manual_override,
  bmd.updated_at AS market_updated_at,

  CASE
    WHEN bmd.priority_rank IS NOT NULL THEN LEAST(GREATEST(bmd.priority_rank, 1), 9999)
    WHEN bmd.tier = 1 THEN 100
    WHEN bmd.tier = 2 THEN 200
    WHEN bmd.tier = 3 THEN 300
    ELSE 900
  END AS suggested_package_priority

FROM public.berufe b
JOIN public.beruf_market_data bmd
  ON bmd.beruf_id = b.id;

COMMENT ON VIEW public.v_beruf_priority IS
  'SSOT: fine-grained package priority. Lower number = higher priority. Uses priority_rank if available; otherwise tier fallback buckets.';

-- 4) Neue Admin-SSOT-View: genau ein sichtbares Paket je curriculum
CREATE OR REPLACE VIEW public.v_admin_visible_course_packages AS
WITH ranked AS (
  SELECT
    cp.*,
    ROW_NUMBER() OVER (
      PARTITION BY cp.curriculum_id
      ORDER BY
        CASE cp.status
          WHEN 'building'  THEN 1
          WHEN 'queued'    THEN 2
          WHEN 'failed'    THEN 3
          WHEN 'planning'  THEN 4
          WHEN 'draft'     THEN 5
          WHEN 'published' THEN 6
          WHEN 'done'      THEN 7
          ELSE 99
        END,
        cp.priority ASC NULLS LAST,
        cp.updated_at DESC,
        cp.created_at DESC,
        cp.id DESC
    ) AS rn
  FROM public.course_packages cp
  WHERE cp.status <> 'archived'
    AND cp.curriculum_id IS NOT NULL
)
SELECT *
FROM ranked
WHERE rn = 1;

COMMENT ON VIEW public.v_admin_visible_course_packages IS
  'SSOT admin listing: exactly one visible package per curriculum_id.';

-- 5) v_latest_course_package auf curriculum statt course härten
CREATE OR REPLACE VIEW public.v_latest_course_package AS
WITH ranked AS (
  SELECT
    cp.*,
    ROW_NUMBER() OVER (
      PARTITION BY cp.curriculum_id
      ORDER BY cp.updated_at DESC, cp.created_at DESC, cp.id DESC
    ) AS rn
  FROM public.course_packages cp
  WHERE cp.status <> 'archived'
    AND cp.curriculum_id IS NOT NULL
)
SELECT *
FROM ranked
WHERE rn = 1;

COMMENT ON VIEW public.v_latest_course_package IS
  'Latest non-archived package per curriculum_id (not course_id).';

-- 6) Claim RPC härten: top gate + echte Reihenfolge
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
  v_top_incomplete int;
  v_effective_status text;
  v_raw_val text;
  v_priority_gate int;
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
    RETURN NULL;
  END IF;

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

  INSERT INTO public.package_leases (package_id, runner_id, lease_until)
  VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
  ON CONFLICT (package_id) DO UPDATE
  SET runner_id = EXCLUDED.runner_id,
      lease_until = EXCLUDED.lease_until;

  RETURN v_package_id;
END;
$$;

COMMENT ON FUNCTION public.acquire_next_package_lease_v2(text, integer, text) IS
  'SSOT package claim: strict priority gate + fine-grained priority ordering. Lower numeric priority wins.';

-- 7) Ops default for gate
INSERT INTO public.ops_pipeline_config(key, value)
VALUES ('priority_gate_rank', '50'::jsonb)
ON CONFLICT (key) DO NOTHING;
