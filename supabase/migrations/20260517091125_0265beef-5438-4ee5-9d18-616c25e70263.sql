
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES ('customer_safe_v1_hardened_lessons_ssot', '{}', 'lessons_gap')
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE VIEW public.v_package_customer_safe_v1 AS
WITH base AS (
  SELECT cp.id AS package_id,
         cp.title AS package_title,
         cp.package_key,
         cp.curriculum_id,
         cp.status AS package_status,
         cp.track::text AS track,
         cp.status = 'published'::text AS published,
         s.gap_class,
         s.gap_class IS NULL OR (s.gap_class = ANY (ARRAY['none'::text,'sellable'::text])) AS sellable,
         s.product_id,
         s.course_id,
         d2.delivery_ready_v2 AS delivery_ready_legacy,
         d2.cap_tutor_ok AS tutor_context_ready,
         d2.cap_exam_pool_ok AS exam_trainer_ready,
         d2.blocking_reasons_v2 AS delivery_blocking_reasons,
         d2.caps AS delivery_caps,
         ppr.product_public,
         ppr.has_stripe_price,
         ppr.license_template_ready,
         ppr.commerce_gate_state,
         ppr.readiness_state AS post_publish_state,
         lgs.classification AS lessons_classification_raw,
         lgs.customer_safe_for_lessons AS lessons_delivery_ready_raw,
         cp.lesson_policy
    FROM public.course_packages cp
    LEFT JOIN public.v_package_sellability_v1        s   ON s.package_id = cp.id
    LEFT JOIN public.v_package_delivery_readiness_v2 d2  ON d2.course_package_id = cp.id
    LEFT JOIN public.v_post_publish_readiness        ppr ON ppr.package_id = cp.id
    LEFT JOIN public.v_lessons_gap_ssot              lgs ON lgs.package_id = cp.id
   WHERE cp.status = 'published'::text
), flagged AS (
  SELECT b.*,
         COALESCE(b.lessons_delivery_ready_raw, false) AS lessons_delivery_ready_eff,
         CASE
           WHEN b.lessons_classification_raw IS NULL THEN 'NO_CLASSIFICATION'
           ELSE b.lessons_classification_raw
         END AS lessons_delivery_reason_eff,
         COALESCE(b.tutor_context_ready, false) AS tutor_ready_eff,
         COALESCE(b.exam_trainer_ready, false)  AS exam_pool_ready_eff,
         COALESCE(b.product_public, false)
           AND COALESCE(b.has_stripe_price, false)
           AND COALESCE(b.license_template_ready, false) AS entitlement_ready_eff
    FROM base b
), composed AS (
  SELECT f.*,
         COALESCE(f.delivery_ready_legacy, false)
           AND f.lessons_delivery_ready_eff
         AS delivery_ready_eff
    FROM flagged f
)
SELECT
  package_id,
  package_key,
  package_title,
  curriculum_id,
  product_id,
  course_id,
  package_status,
  track,
  published,
  sellable,
  delivery_ready_eff      AS delivery_ready,
  entitlement_ready_eff   AS entitlement_ready,
  tutor_ready_eff         AS tutor_ready,
  exam_pool_ready_eff     AS exam_pool_ready,
  published
    AND sellable
    AND delivery_ready_eff
    AND entitlement_ready_eff
    AND tutor_ready_eff
    AND exam_pool_ready_eff
    AS customer_safe,
  array_remove(ARRAY[
    CASE WHEN NOT published                  THEN 'NOT_PUBLISHED'                        END,
    CASE WHEN NOT sellable                   THEN 'NOT_SELLABLE:' || COALESCE(gap_class,'unknown') END,
    CASE WHEN NOT delivery_ready_eff         THEN 'NOT_DELIVERY_READY'                   END,
    CASE WHEN NOT lessons_delivery_ready_eff THEN 'NOT_LESSONS_DELIVERY_READY:' || lessons_delivery_reason_eff END,
    CASE WHEN NOT entitlement_ready_eff      THEN 'NOT_ENTITLEMENT_READY'                END,
    CASE WHEN NOT tutor_ready_eff            THEN 'NOT_TUTOR_READY'                      END,
    CASE WHEN NOT exam_pool_ready_eff        THEN 'NOT_EXAM_POOL_READY'                  END
  ], NULL) AS missing_dimensions,
  gap_class,
  delivery_blocking_reasons,
  commerce_gate_state,
  post_publish_state,
  jsonb_build_object(
    'product_public',           product_public,
    'has_stripe_price',         has_stripe_price,
    'license_template_ready',   license_template_ready,
    'tutor_context_ready',      tutor_context_ready,
    'exam_trainer_ready',       exam_trainer_ready,
    'delivery_caps',            delivery_caps,
    'lessons_delivery_ready',   lessons_delivery_ready_eff,
    'lessons_delivery_reason',  lessons_delivery_reason_eff,
    'lessons_classification',   lessons_classification_raw,
    'lesson_policy',            lesson_policy,
    'delivery_ready_legacy_v2', delivery_ready_legacy
  ) AS sub_flags,
  lessons_delivery_ready_eff   AS lessons_delivery_ready,
  lessons_delivery_reason_eff  AS lessons_delivery_reason,
  lesson_policy
FROM composed;

REVOKE ALL ON public.v_package_customer_safe_v1 FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_package_customer_safe_v1 TO service_role;

COMMENT ON VIEW public.v_package_customer_safe_v1 IS
'Phase E1 SSOT-Härtung: delivery_ready = legacy_v2 AND lessons_delivery_ready (HAS_READY oder EXEMPT in v_lessons_gap_ssot).';

DO $$
DECLARE v_total int; v_safe int; v_lessons_ready int; v_lessons_reasons jsonb;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE customer_safe),
         COUNT(*) FILTER (WHERE lessons_delivery_ready)
    INTO v_total, v_safe, v_lessons_ready
    FROM public.v_package_customer_safe_v1;

  SELECT jsonb_object_agg(lessons_delivery_reason, n)
    INTO v_lessons_reasons
    FROM (
      SELECT lessons_delivery_reason, COUNT(*) AS n
      FROM public.v_package_customer_safe_v1
      GROUP BY lessons_delivery_reason
    ) q;

  PERFORM public.fn_emit_audit(
    'customer_safe_v1_hardened_lessons_ssot'::text,
    'system'::text,
    NULL::text,
    'success'::text,
    jsonb_build_object(
      'total_published', v_total,
      'customer_safe', v_safe,
      'lessons_delivery_ready', v_lessons_ready,
      'lessons_reasons_breakdown', v_lessons_reasons,
      'composition', 'delivery_ready = delivery_ready_legacy AND lessons_delivery_ready',
      'lessons_source', 'v_lessons_gap_ssot.classification IN (HAS_READY,EXEMPT)',
      'hardened_at', now()
    ),
    'phase_e1'::text,
    NULL::text
  );
END $$;
