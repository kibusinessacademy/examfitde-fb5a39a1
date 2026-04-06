
-- ============================================================
-- Phase 3: blueprint_variant_inventory table
-- (Phase 1+2 already applied in previous partial migration)
-- ============================================================

-- Check: table may already exist from partial migration
-- If it does, this is a no-op. If not, create it.
CREATE TABLE IF NOT EXISTS public.blueprint_variant_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  package_id uuid,
  target_count int NOT NULL DEFAULT 20,
  materialized_count int NOT NULL DEFAULT 0,
  approved_count int NOT NULL DEFAULT 0,
  coverage_ratio numeric GENERATED ALWAYS AS (
    CASE WHEN target_count > 0
         THEN round(materialized_count::numeric / target_count, 4)
         ELSE 0 END
  ) STORED,
  status text NOT NULL DEFAULT 'missing',
  last_job_at timestamptz,
  last_error text,
  fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes (IF NOT EXISTS is safe for re-run)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bvi_blueprint_curriculum
  ON public.blueprint_variant_inventory (blueprint_id, curriculum_id);
CREATE INDEX IF NOT EXISTS idx_bvi_curriculum ON public.blueprint_variant_inventory (curriculum_id);
CREATE INDEX IF NOT EXISTS idx_bvi_status ON public.blueprint_variant_inventory (status);
CREATE INDEX IF NOT EXISTS idx_bvi_package ON public.blueprint_variant_inventory (package_id) WHERE package_id IS NOT NULL;

ALTER TABLE public.blueprint_variant_inventory ENABLE ROW LEVEL SECURITY;

-- RLS policies (drop first to be idempotent)
DROP POLICY IF EXISTS "Admin read blueprint_variant_inventory" ON public.blueprint_variant_inventory;
DROP POLICY IF EXISTS "Admin write blueprint_variant_inventory" ON public.blueprint_variant_inventory;

CREATE POLICY "Admin read blueprint_variant_inventory"
  ON public.blueprint_variant_inventory FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin write blueprint_variant_inventory"
  ON public.blueprint_variant_inventory FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Trigger: auto-update updated_at
DROP TRIGGER IF EXISTS update_bvi_updated_at ON public.blueprint_variant_inventory;
CREATE TRIGGER update_bvi_updated_at
  BEFORE UPDATE ON public.blueprint_variant_inventory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Auto-derive status from counts
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_bvi_auto_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.materialized_count = 0 THEN
    NEW.status := 'missing';
  ELSIF NEW.materialized_count < NEW.target_count THEN
    NEW.status := 'partial';
  ELSIF NEW.approved_count >= GREATEST(3, (NEW.target_count * 0.5)::int) THEN
    NEW.status := 'ready';
  ELSE
    NEW.status := 'partial';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bvi_auto_status ON public.blueprint_variant_inventory;
CREATE TRIGGER trg_bvi_auto_status
  BEFORE INSERT OR UPDATE OF materialized_count, approved_count, target_count
  ON public.blueprint_variant_inventory
  FOR EACH ROW EXECUTE FUNCTION public.fn_bvi_auto_status();

-- ============================================================
-- Readiness check function
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_is_variant_inventory_ready(p_package_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM blueprint_variant_inventory bvi
    JOIN course_packages cp ON cp.curriculum_id = bvi.curriculum_id
    WHERE cp.id = p_package_id
      AND bvi.status NOT IN ('ready')
  )
  AND EXISTS (
    SELECT 1
    FROM blueprint_variant_inventory bvi
    JOIN course_packages cp ON cp.curriculum_id = bvi.curriculum_id
    WHERE cp.id = p_package_id
  );
$$;

-- ============================================================
-- Update package prebuild status from inventory
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_update_package_prebuild_status(p_package_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total int;
  v_ready int;
  v_missing int;
  v_failed int;
  v_new_status text;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'ready'),
    count(*) FILTER (WHERE status = 'missing'),
    count(*) FILTER (WHERE status = 'invalid')
  INTO v_total, v_ready, v_missing, v_failed
  FROM blueprint_variant_inventory bvi
  JOIN course_packages cp ON cp.curriculum_id = bvi.curriculum_id
  WHERE cp.id = p_package_id;

  IF v_total = 0 THEN
    v_new_status := 'pending';
  ELSIF v_failed > 0 THEN
    v_new_status := 'failed';
  ELSIF v_ready = v_total THEN
    v_new_status := 'ready';
  ELSIF v_missing = v_total THEN
    v_new_status := 'pending';
  ELSE
    v_new_status := 'materializing';
  END IF;

  UPDATE course_packages
  SET variant_prebuild_status = v_new_status
  WHERE id = p_package_id
    AND variant_prebuild_status IS DISTINCT FROM v_new_status;

  RETURN v_new_status;
END;
$$;

-- ============================================================
-- Update claim_pending_jobs_v4: pool-aware routing
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(
  p_worker_id text,
  p_limit int DEFAULT 5,
  p_worker_pool text DEFAULT NULL
)
RETURNS SETOF job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimable_raw AS (
    SELECT jq.id, jq.job_type
    FROM job_queue jq
    LEFT JOIN course_packages cp ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN job_type_policies jtp ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      -- Pool routing: worker requests specific pool or gets 'default'
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
  UPDATE job_queue q
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
-- Migrate existing pending variant jobs to prebuild pool
-- ============================================================

UPDATE job_queue
SET worker_pool = 'prebuild'
WHERE job_type IN (
  'package_generate_blueprint_variants',
  'package_validate_blueprint_variants',
  'package_promote_blueprint_variants'
)
AND status IN ('pending', 'processing');
