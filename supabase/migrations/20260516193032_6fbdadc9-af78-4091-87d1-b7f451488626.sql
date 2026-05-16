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
    -- FIX: gap_class='sellable' ist Erfolgs-Status der Sellability-SSOT
    (s.gap_class IS NULL OR s.gap_class IN ('none','sellable')) AS sellable,
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
  f.package_id, f.package_key, f.package_title, f.curriculum_id,
  f.product_id, f.course_id, f.package_status,
  f.published, f.sellable,
  f.delivery_ready_eff   AS delivery_ready,
  f.entitlement_ready_eff AS entitlement_ready,
  f.tutor_ready_eff      AS tutor_ready,
  f.exam_pool_ready_eff  AS exam_pool_ready,
  (f.published AND f.sellable AND f.delivery_ready_eff AND f.entitlement_ready_eff
    AND f.tutor_ready_eff AND f.exam_pool_ready_eff)     AS customer_safe,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT f.published              THEN 'NOT_PUBLISHED'      END,
    CASE WHEN NOT f.sellable               THEN 'NOT_SELLABLE:'||COALESCE(f.gap_class,'unknown') END,
    CASE WHEN NOT f.delivery_ready_eff     THEN 'NOT_DELIVERY_READY' END,
    CASE WHEN NOT f.entitlement_ready_eff  THEN 'NOT_ENTITLEMENT_READY' END,
    CASE WHEN NOT f.tutor_ready_eff        THEN 'NOT_TUTOR_READY'    END,
    CASE WHEN NOT f.exam_pool_ready_eff    THEN 'NOT_EXAM_POOL_READY' END
  ], NULL)                          AS missing_dimensions,
  f.gap_class, f.delivery_blocking_reasons,
  f.commerce_gate_state, f.post_publish_state,
  jsonb_build_object(
    'product_public',          f.product_public,
    'has_stripe_price',        f.has_stripe_price,
    'license_template_ready',  f.license_template_ready,
    'tutor_context_ready',     f.tutor_context_ready,
    'exam_trainer_ready',      f.exam_trainer_ready
  )                                 AS sub_flags
FROM flagged f;

REVOKE ALL ON public.v_package_customer_safe_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_package_customer_safe_v1 TO service_role;

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'customer_safe_ssot_fix_sellable_class',
  'system',
  'success',
  jsonb_build_object('fix', 'gap_class=sellable is success state, not gap')
);