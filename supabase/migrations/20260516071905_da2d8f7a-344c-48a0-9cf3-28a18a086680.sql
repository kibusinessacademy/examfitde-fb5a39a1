
-- Post-Purchase Delivery Assurance v1 — Migration A (retry)

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_blocking_reasons text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS delivery_last_checked_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_status_check') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_delivery_status_check
      CHECK (delivery_status IN ('pending','in_progress','confirmed','blocked','failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_paid_delivery_pending
  ON public.orders(created_at)
  WHERE status = 'paid' AND delivery_status <> 'confirmed';

DROP VIEW IF EXISTS public.v_sellable_and_deliverable CASCADE;
DROP VIEW IF EXISTS public.v_course_delivery_readiness CASCADE;

CREATE VIEW public.v_course_delivery_readiness AS
WITH pkg AS (
  SELECT id AS course_package_id, curriculum_id, product_id, status, build_progress
  FROM public.course_packages
  WHERE archived = false
),
mc AS (
  SELECT package_id, COUNT(*) FILTER (WHERE status = 'approved') AS approved_cnt
  FROM public.minicheck_questions WHERE package_id IS NOT NULL GROUP BY package_id
),
eq AS (
  SELECT package_id, COUNT(*) FILTER (WHERE status = 'approved') AS approved_cnt
  FROM public.exam_questions WHERE package_id IS NOT NULL GROUP BY package_id
),
oe AS (
  SELECT package_id, COUNT(*) AS bp_cnt
  FROM public.oral_exam_blueprints WHERE package_id IS NOT NULL AND status = 'approved' GROUP BY package_id
),
ti AS (
  SELECT package_id, COUNT(*) AS idx_cnt
  FROM public.ai_tutor_context_index WHERE package_id IS NOT NULL GROUP BY package_id
)
SELECT
  p.course_package_id, p.curriculum_id, p.product_id, p.status AS package_status, p.build_progress,
  COALESCE(mc.approved_cnt,0) AS minichecks_approved_count,
  COALESCE(eq.approved_cnt,0) AS exam_questions_approved_count,
  COALESCE(oe.bp_cnt,0)       AS oral_blueprints_count,
  COALESCE(ti.idx_cnt,0)      AS tutor_index_count,
  (COALESCE(mc.approved_cnt,0) >= 10) AS minichecks_ready,
  (COALESCE(eq.approved_cnt,0) >= 50) AS exam_trainer_ready,
  (COALESCE(ti.idx_cnt,0) >= 1)       AS tutor_context_ready,
  (COALESCE(oe.bp_cnt,0) >= 1)        AS oral_exam_ready,
  true AS h5p_assets_ready,
  true AS storage_assets_accessible,
  (COALESCE(mc.approved_cnt,0) >= 10
   AND COALESCE(eq.approved_cnt,0) >= 50
   AND COALESCE(ti.idx_cnt,0) >= 1) AS delivery_ready,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN COALESCE(mc.approved_cnt,0) < 10 THEN 'minichecks_unready'  END,
    CASE WHEN COALESCE(eq.approved_cnt,0) < 50 THEN 'exam_pool_unready'   END,
    CASE WHEN COALESCE(ti.idx_cnt,0) < 1       THEN 'tutor_index_missing' END,
    CASE WHEN COALESCE(oe.bp_cnt,0) < 1        THEN 'oral_exam_missing'   END
  ], NULL) AS blocking_reasons
FROM pkg p
LEFT JOIN mc ON mc.package_id = p.course_package_id
LEFT JOIN eq ON eq.package_id = p.course_package_id
LEFT JOIN oe ON oe.package_id = p.course_package_id
LEFT JOIN ti ON ti.package_id = p.course_package_id;

REVOKE ALL ON public.v_course_delivery_readiness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_course_delivery_readiness TO service_role;

CREATE VIEW public.v_sellable_and_deliverable AS
SELECT
  cp.id AS course_package_id,
  cp.curriculum_id,
  cp.product_id,
  cp.status AS package_status,
  cp.is_published,
  dr.delivery_ready,
  dr.blocking_reasons AS delivery_blocking_reasons,
  EXISTS (
    SELECT 1 FROM public.products pr
    WHERE pr.id = cp.product_id AND pr.status = 'active' AND pr.visibility = 'public'
  ) AS product_public,
  EXISTS (
    SELECT 1 FROM public.product_prices pp
    WHERE pp.product_id = cp.product_id AND pp.active = true AND pp.stripe_price_id IS NOT NULL
  ) AS has_stripe_price,
  (cp.is_published = true
    AND dr.delivery_ready = true
    AND EXISTS (SELECT 1 FROM public.products pr WHERE pr.id = cp.product_id AND pr.status='active' AND pr.visibility='public')
    AND EXISTS (SELECT 1 FROM public.product_prices pp WHERE pp.product_id = cp.product_id AND pp.active=true AND pp.stripe_price_id IS NOT NULL)
  ) AS is_sellable_and_deliverable
FROM public.course_packages cp
LEFT JOIN public.v_course_delivery_readiness dr ON dr.course_package_id = cp.id
WHERE cp.archived = false;

REVOKE ALL ON public.v_sellable_and_deliverable FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_sellable_and_deliverable TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_course_delivery_readiness(
  p_package_id uuid DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  course_package_id uuid, curriculum_id uuid, product_id uuid,
  package_status text, delivery_ready boolean, is_sellable_and_deliverable boolean,
  blocking_reasons text[],
  minichecks_approved_count bigint, exam_questions_approved_count bigint,
  tutor_index_count bigint, oral_blueprints_count bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    sd.course_package_id, sd.curriculum_id, sd.product_id,
    sd.package_status, sd.delivery_ready, sd.is_sellable_and_deliverable,
    sd.delivery_blocking_reasons,
    dr.minichecks_approved_count, dr.exam_questions_approved_count,
    dr.tutor_index_count, dr.oral_blueprints_count
  FROM public.v_sellable_and_deliverable sd
  LEFT JOIN public.v_course_delivery_readiness dr ON dr.course_package_id = sd.course_package_id
  WHERE public.has_role(auth.uid(), 'admin')
    AND (p_package_id IS NULL OR sd.course_package_id = p_package_id)
  ORDER BY sd.is_sellable_and_deliverable, sd.course_package_id
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.admin_get_course_delivery_readiness(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_course_delivery_readiness(uuid, int) TO authenticated, service_role;

INSERT INTO public.auto_heal_log(action_type, target_type, result_status, result_detail, metadata)
VALUES (
  'post_purchase_delivery_assurance_v1_migration_a',
  'system','success',
  'orders.delivery_* + v_course_delivery_readiness + v_sellable_and_deliverable + admin RPC live',
  jsonb_build_object('migration','A','timestamp', now())
);
