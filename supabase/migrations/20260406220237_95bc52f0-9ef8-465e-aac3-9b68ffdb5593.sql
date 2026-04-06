
-- ============================================================
-- 1. Fix fn_is_variant_inventory_ready — check against SSOT blueprint set
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_is_variant_inventory_ready(p_package_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pkg AS (
    SELECT cp.id, cp.curriculum_id
    FROM public.course_packages cp
    WHERE cp.id = p_package_id
  ),
  required_blueprints AS (
    SELECT qb.id
    FROM public.question_blueprints qb
    JOIN pkg p ON p.curriculum_id = qb.curriculum_id
    WHERE qb.status = 'approved'
  )
  SELECT
    EXISTS (SELECT 1 FROM required_blueprints)
    AND NOT EXISTS (
      SELECT 1
      FROM required_blueprints rb
      LEFT JOIN public.blueprint_variant_inventory bvi
        ON bvi.blueprint_id = rb.id
       AND bvi.curriculum_id = (SELECT curriculum_id FROM pkg)
      WHERE bvi.id IS NULL
         OR bvi.status <> 'ready'
    );
$$;

-- ============================================================
-- 2. Fix fn_update_package_prebuild_status — derive from full blueprint set
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_update_package_prebuild_status(p_package_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_total int := 0;
  v_ready int := 0;
  v_missing int := 0;
  v_invalid int := 0;
  v_new_status text;
BEGIN
  SELECT cp.curriculum_id INTO v_curriculum_id
  FROM public.course_packages cp
  WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN 'pending';
  END IF;

  WITH required_blueprints AS (
    SELECT qb.id
    FROM public.question_blueprints qb
    WHERE qb.curriculum_id = v_curriculum_id
      AND qb.status = 'approved'
  ),
  coverage AS (
    SELECT
      rb.id AS blueprint_id,
      bvi.status
    FROM required_blueprints rb
    LEFT JOIN public.blueprint_variant_inventory bvi
      ON bvi.blueprint_id = rb.id
     AND bvi.curriculum_id = v_curriculum_id
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'ready'),
    count(*) FILTER (WHERE status IS NULL OR status = 'missing'),
    count(*) FILTER (WHERE status = 'invalid')
  INTO v_total, v_ready, v_missing, v_invalid
  FROM coverage;

  IF v_total = 0 THEN
    v_new_status := 'not_required';
  ELSIF v_invalid > 0 THEN
    v_new_status := 'failed';
  ELSIF v_ready = v_total THEN
    v_new_status := 'ready';
  ELSIF v_missing = v_total THEN
    v_new_status := 'pending';
  ELSE
    v_new_status := 'materializing';
  END IF;

  UPDATE public.course_packages
  SET variant_prebuild_status = v_new_status
  WHERE id = p_package_id
    AND variant_prebuild_status IS DISTINCT FROM v_new_status;

  RETURN v_new_status;
END;
$$;

-- ============================================================
-- 3. Fix claim_pending_jobs_v4 — restore p_lock_timeout_minutes for compat
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(
  p_worker_id text,
  p_limit int DEFAULT 5,
  p_lock_timeout_minutes int DEFAULT 30,
  p_worker_pool text DEFAULT NULL
)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimable_raw AS (
    SELECT jq.id, jq.job_type
    FROM public.job_queue jq
    LEFT JOIN public.course_packages cp
      ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN public.job_type_policies jtp
      ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (
        CASE
          WHEN p_worker_pool IS NOT NULL THEN
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = p_worker_pool
          ELSE
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = 'default'
        END
      )
      AND (
        cp.id IS NULL
        OR cp.status = 'building'
        OR COALESCE(jtp.can_run_when_not_building, false)
      )
    ORDER BY jq.priority DESC NULLS LAST, jq.created_at ASC
    FOR UPDATE OF jq SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.job_queue q
  SET status = 'processing',
      started_at = now(),
      locked_by = p_worker_id,
      locked_at = now()
  FROM claimable_raw c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$$;

-- ============================================================
-- 4. Create fn_upsert_variant_inventory
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_upsert_variant_inventory(
  p_blueprint_id uuid,
  p_curriculum_id uuid,
  p_package_id uuid DEFAULT NULL,
  p_target_count int DEFAULT 6,
  p_new_materialized int DEFAULT 0,
  p_new_approved int DEFAULT 0,
  p_last_error text DEFAULT NULL,
  p_fingerprint text DEFAULT NULL
)
RETURNS public.blueprint_variant_inventory
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.blueprint_variant_inventory;
BEGIN
  INSERT INTO public.blueprint_variant_inventory (
    blueprint_id,
    curriculum_id,
    package_id,
    target_count,
    materialized_count,
    approved_count,
    last_job_at,
    last_error,
    fingerprint
  )
  VALUES (
    p_blueprint_id,
    p_curriculum_id,
    p_package_id,
    GREATEST(1, p_target_count),
    GREATEST(0, p_new_materialized),
    GREATEST(0, p_new_approved),
    now(),
    p_last_error,
    p_fingerprint
  )
  ON CONFLICT (blueprint_id, curriculum_id)
  DO UPDATE SET
    package_id = COALESCE(EXCLUDED.package_id, public.blueprint_variant_inventory.package_id),
    target_count = GREATEST(public.blueprint_variant_inventory.target_count, EXCLUDED.target_count),
    materialized_count = public.blueprint_variant_inventory.materialized_count + EXCLUDED.materialized_count,
    approved_count = public.blueprint_variant_inventory.approved_count + EXCLUDED.approved_count,
    last_job_at = now(),
    last_error = EXCLUDED.last_error,
    fingerprint = COALESCE(EXCLUDED.fingerprint, public.blueprint_variant_inventory.fingerprint),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ============================================================
-- 5. Add CHECK constraint on variant_prebuild_status
-- ============================================================
ALTER TABLE public.course_packages
  DROP CONSTRAINT IF EXISTS course_packages_variant_prebuild_status_check;

ALTER TABLE public.course_packages
  ADD CONSTRAINT course_packages_variant_prebuild_status_check
  CHECK (variant_prebuild_status IN ('pending','materializing','ready','failed','not_required'));
