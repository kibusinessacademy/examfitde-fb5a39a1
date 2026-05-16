-- =====================================================
-- v_package_customer_safe_v1 — Unified Readiness SSOT
-- Full Merge (6 dims) + Reason-Breakdown
-- =====================================================
-- Dimensionen:
--   1. published         (course_packages.status='published')
--   2. sellable          (v_package_sellability_v1.gap_class IN ('none','published_locked_repairable')→sellable)
--   3. delivery_ready    (v_course_delivery_readiness.delivery_ready)
--   4. entitlement_ready (v_post_publish_readiness: product_public AND has_stripe_price AND license_template_ready)
--   5. tutor_ready       (v_course_delivery_readiness.tutor_context_ready)
--   6. exam_pool_ready   (v_course_delivery_readiness.exam_trainer_ready)
-- customer_safe = ALL 6 true. reasons[] listet fehlende Dimensionen.

CREATE OR REPLACE VIEW public.v_package_customer_safe_v1 AS
WITH base AS (
  SELECT
    cp.id                          AS package_id,
    cp.title                       AS package_title,
    cp.package_key,
    cp.curriculum_id,
    cp.status                      AS package_status,
    (cp.status = 'published')      AS published,
    s.gap_class,
    -- sellable: keine harten Content-/Pricing-Gaps mehr
    (s.gap_class IS NULL OR s.gap_class IN ('none')) AS sellable,
    s.product_id,
    s.course_id,
    cdr.delivery_ready,
    cdr.tutor_context_ready,
    cdr.exam_trainer_ready,
    cdr.blocking_reasons           AS delivery_blocking_reasons,
    ppr.product_public,
    ppr.has_stripe_price,
    ppr.license_template_ready,
    ppr.commerce_gate_state,
    ppr.readiness_state            AS post_publish_state
  FROM public.course_packages cp
  LEFT JOIN public.v_package_sellability_v1     s   ON s.package_id = cp.id
  LEFT JOIN public.v_course_delivery_readiness  cdr ON cdr.course_package_id = cp.id
  LEFT JOIN public.v_post_publish_readiness     ppr ON ppr.package_id = cp.id
  WHERE cp.status = 'published'
),
flagged AS (
  SELECT
    b.*,
    COALESCE(b.delivery_ready, false)                                      AS delivery_ready_eff,
    COALESCE(b.tutor_context_ready, false)                                 AS tutor_ready_eff,
    COALESCE(b.exam_trainer_ready, false)                                  AS exam_pool_ready_eff,
    (COALESCE(b.product_public, false)
      AND COALESCE(b.has_stripe_price, false)
      AND COALESCE(b.license_template_ready, false))                       AS entitlement_ready_eff
  FROM base b
)
SELECT
  f.package_id,
  f.package_key,
  f.package_title,
  f.curriculum_id,
  f.product_id,
  f.course_id,
  f.package_status,
  -- 6 Dimensionen (boolean)
  f.published,
  f.sellable,
  f.delivery_ready_eff   AS delivery_ready,
  f.entitlement_ready_eff AS entitlement_ready,
  f.tutor_ready_eff      AS tutor_ready,
  f.exam_pool_ready_eff  AS exam_pool_ready,
  -- Master Flag
  (f.published
    AND f.sellable
    AND f.delivery_ready_eff
    AND f.entitlement_ready_eff
    AND f.tutor_ready_eff
    AND f.exam_pool_ready_eff)     AS customer_safe,
  -- Reason-Breakdown
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT f.published              THEN 'NOT_PUBLISHED'      END,
    CASE WHEN NOT f.sellable               THEN 'NOT_SELLABLE:'||COALESCE(f.gap_class,'unknown') END,
    CASE WHEN NOT f.delivery_ready_eff     THEN 'NOT_DELIVERY_READY' END,
    CASE WHEN NOT f.entitlement_ready_eff  THEN 'NOT_ENTITLEMENT_READY' END,
    CASE WHEN NOT f.tutor_ready_eff        THEN 'NOT_TUTOR_READY'    END,
    CASE WHEN NOT f.exam_pool_ready_eff    THEN 'NOT_EXAM_POOL_READY' END
  ], NULL)                          AS missing_dimensions,
  -- Detail-Subreasons (passthrough)
  f.gap_class,
  f.delivery_blocking_reasons,
  f.commerce_gate_state,
  f.post_publish_state,
  jsonb_build_object(
    'product_public',          f.product_public,
    'has_stripe_price',        f.has_stripe_price,
    'license_template_ready',  f.license_template_ready,
    'tutor_context_ready',     f.tutor_context_ready,
    'exam_trainer_ready',      f.exam_trainer_ready
  )                                 AS sub_flags
FROM flagged f;

COMMENT ON VIEW public.v_package_customer_safe_v1 IS
  'Unified Customer-Safe SSOT: published+sellable+delivery+entitlement+tutor+exam_pool. reasons[] for diagnostics. Read via admin_get_customer_safe_summary RPC.';

-- Lock down: admins only via RPC
REVOKE ALL ON public.v_package_customer_safe_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_package_customer_safe_v1 TO service_role;

-- =====================================================
-- Admin RPCs (SECURITY DEFINER + has_role gate)
-- =====================================================

CREATE OR REPLACE FUNCTION public.admin_get_customer_safe_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_total int;
  v_safe int;
  v_by_dim jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE customer_safe)
    INTO v_total, v_safe
  FROM public.v_package_customer_safe_v1;

  SELECT jsonb_build_object(
    'not_sellable',          COUNT(*) FILTER (WHERE NOT sellable),
    'not_delivery_ready',    COUNT(*) FILTER (WHERE NOT delivery_ready),
    'not_entitlement_ready', COUNT(*) FILTER (WHERE NOT entitlement_ready),
    'not_tutor_ready',       COUNT(*) FILTER (WHERE NOT tutor_ready),
    'not_exam_pool_ready',   COUNT(*) FILTER (WHERE NOT exam_pool_ready)
  ) INTO v_by_dim
  FROM public.v_package_customer_safe_v1;

  RETURN jsonb_build_object(
    'total_published', v_total,
    'customer_safe',   v_safe,
    'gap',             v_total - v_safe,
    'missing_by_dim',  v_by_dim,
    'computed_at',     now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_customer_safe_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_customer_safe_summary() TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_get_customer_safe_packages(
  _only_unsafe boolean DEFAULT true,
  _limit int DEFAULT 200
)
RETURNS TABLE(
  package_id uuid,
  package_key text,
  package_title text,
  customer_safe boolean,
  published boolean,
  sellable boolean,
  delivery_ready boolean,
  entitlement_ready boolean,
  tutor_ready boolean,
  exam_pool_ready boolean,
  missing_dimensions text[],
  gap_class text,
  delivery_blocking_reasons text[],
  commerce_gate_state text,
  post_publish_state text,
  sub_flags jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT
    v.package_id, v.package_key, v.package_title,
    v.customer_safe, v.published, v.sellable,
    v.delivery_ready, v.entitlement_ready, v.tutor_ready, v.exam_pool_ready,
    v.missing_dimensions, v.gap_class, v.delivery_blocking_reasons,
    v.commerce_gate_state, v.post_publish_state, v.sub_flags
  FROM public.v_package_customer_safe_v1 v
  WHERE (NOT _only_unsafe) OR (NOT v.customer_safe)
  ORDER BY v.customer_safe ASC, v.package_title
  LIMIT GREATEST(_limit, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_customer_safe_packages(boolean, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_customer_safe_packages(boolean, int) TO authenticated;

-- =====================================================
-- Smoke-Audit
-- =====================================================
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'customer_safe_ssot_init',
  'system',
  'success',
  jsonb_build_object(
    'view', 'v_package_customer_safe_v1',
    'rpcs', ARRAY['admin_get_customer_safe_summary','admin_get_customer_safe_packages'],
    'dimensions', ARRAY['published','sellable','delivery_ready','entitlement_ready','tutor_ready','exam_pool_ready'],
    'note', 'P0 unified readiness SSOT — Full Merge + reason breakdown'
  )
);