
CREATE OR REPLACE FUNCTION public.fn_delivery_capability_matrix(_track text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE upper(COALESCE(_track,''))
    WHEN 'EXAM_FIRST' THEN jsonb_build_object('requires_lessons',false,'requires_minichecks',false,'requires_exam_pool',true,'requires_tutor_context',true,'requires_oral',false,'requires_h5p',false,'requires_storage_assets',false)
    WHEN 'EXAM_FIRST_PLUS' THEN jsonb_build_object('requires_lessons',false,'requires_minichecks',false,'requires_exam_pool',true,'requires_tutor_context',true,'requires_oral',true,'requires_h5p',true,'requires_storage_assets',false)
    WHEN 'AUSBILDUNG_VOLL' THEN jsonb_build_object('requires_lessons',true,'requires_minichecks',true,'requires_exam_pool',true,'requires_tutor_context',true,'requires_oral',true,'requires_h5p',true,'requires_storage_assets',true)
    WHEN 'STUDIUM' THEN jsonb_build_object('requires_lessons',true,'requires_minichecks',true,'requires_exam_pool',true,'requires_tutor_context',true,'requires_oral',false,'requires_h5p',true,'requires_storage_assets',true)
    ELSE jsonb_build_object('requires_lessons',false,'requires_minichecks',false,'requires_exam_pool',true,'requires_tutor_context',true,'requires_oral',false,'requires_h5p',false,'requires_storage_assets',false)
  END;
$$;
REVOKE ALL ON FUNCTION public.fn_delivery_capability_matrix(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_delivery_capability_matrix(text) TO service_role, authenticated;

DROP VIEW IF EXISTS public.v_package_delivery_readiness_v2 CASCADE;
CREATE VIEW public.v_package_delivery_readiness_v2 AS
WITH base AS (
  SELECT cp.id AS course_package_id, cp.curriculum_id, cp.product_id, cp.status AS package_status,
    cp.track::text AS track, fn_delivery_capability_matrix(cp.track::text) AS caps,
    cdr.minichecks_approved_count, cdr.exam_questions_approved_count, cdr.oral_blueprints_count, cdr.tutor_index_count,
    cdr.minichecks_ready, cdr.exam_trainer_ready, cdr.tutor_context_ready, cdr.oral_exam_ready,
    cdr.h5p_assets_ready, cdr.storage_assets_accessible
  FROM course_packages cp
  LEFT JOIN v_course_delivery_readiness cdr ON cdr.course_package_id = cp.id
  WHERE cp.archived = false
),
evald AS (
  SELECT b.*,
    (NOT (caps->>'requires_minichecks')::boolean OR COALESCE(minichecks_ready,false)) AS cap_minichecks_ok,
    (NOT (caps->>'requires_exam_pool')::boolean OR COALESCE(exam_trainer_ready,false)) AS cap_exam_pool_ok,
    (NOT (caps->>'requires_tutor_context')::boolean OR COALESCE(tutor_context_ready,false)) AS cap_tutor_ok,
    (NOT (caps->>'requires_oral')::boolean OR COALESCE(oral_exam_ready,false)) AS cap_oral_ok,
    (NOT (caps->>'requires_h5p')::boolean OR COALESCE(h5p_assets_ready,false)) AS cap_h5p_ok,
    (NOT (caps->>'requires_storage_assets')::boolean OR COALESCE(storage_assets_accessible,false)) AS cap_storage_ok,
    (NOT (caps->>'requires_lessons')::boolean OR true) AS cap_lessons_ok
  FROM base b
)
SELECT course_package_id, curriculum_id, product_id, package_status, track, caps,
  minichecks_approved_count, exam_questions_approved_count, oral_blueprints_count, tutor_index_count,
  minichecks_ready, exam_trainer_ready, tutor_context_ready, oral_exam_ready, h5p_assets_ready, storage_assets_accessible,
  cap_minichecks_ok, cap_exam_pool_ok, cap_tutor_ok, cap_oral_ok, cap_h5p_ok, cap_storage_ok, cap_lessons_ok,
  (cap_minichecks_ok AND cap_exam_pool_ok AND cap_tutor_ok AND cap_oral_ok AND cap_h5p_ok AND cap_storage_ok AND cap_lessons_ok) AS delivery_ready_v2,
  array_remove(ARRAY[
    CASE WHEN NOT cap_minichecks_ok THEN 'minichecks_unready' END,
    CASE WHEN NOT cap_exam_pool_ok THEN 'exam_pool_unready' END,
    CASE WHEN NOT cap_tutor_ok THEN 'tutor_context_missing' END,
    CASE WHEN NOT cap_oral_ok THEN 'oral_exam_missing' END,
    CASE WHEN NOT cap_h5p_ok THEN 'h5p_assets_missing' END,
    CASE WHEN NOT cap_storage_ok THEN 'storage_assets_missing' END,
    CASE WHEN NOT cap_lessons_ok THEN 'lessons_missing' END
  ], NULL) AS blocking_reasons_v2
FROM evald;
REVOKE ALL ON public.v_package_delivery_readiness_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_package_delivery_readiness_v2 TO service_role;

DROP VIEW IF EXISTS public.v_package_customer_safe_v1 CASCADE;
CREATE VIEW public.v_package_customer_safe_v1 AS
WITH base AS (
  SELECT cp.id AS package_id, cp.title AS package_title, cp.package_key, cp.curriculum_id,
    cp.status AS package_status, cp.track::text AS track, cp.status = 'published' AS published,
    s.gap_class, (s.gap_class IS NULL OR s.gap_class = ANY (ARRAY['none','sellable'])) AS sellable,
    s.product_id, s.course_id,
    d2.delivery_ready_v2 AS delivery_ready, d2.cap_tutor_ok AS tutor_context_ready,
    d2.cap_exam_pool_ok AS exam_trainer_ready, d2.blocking_reasons_v2 AS delivery_blocking_reasons,
    d2.caps AS delivery_caps,
    ppr.product_public, ppr.has_stripe_price, ppr.license_template_ready,
    ppr.commerce_gate_state, ppr.readiness_state AS post_publish_state
  FROM course_packages cp
  LEFT JOIN v_package_sellability_v1 s ON s.package_id = cp.id
  LEFT JOIN v_package_delivery_readiness_v2 d2 ON d2.course_package_id = cp.id
  LEFT JOIN v_post_publish_readiness ppr ON ppr.package_id = cp.id
  WHERE cp.status = 'published'
),
flagged AS (
  SELECT b.*,
    COALESCE(b.delivery_ready,false) AS delivery_ready_eff,
    COALESCE(b.tutor_context_ready,false) AS tutor_ready_eff,
    COALESCE(b.exam_trainer_ready,false) AS exam_pool_ready_eff,
    (COALESCE(b.product_public,false) AND COALESCE(b.has_stripe_price,false) AND COALESCE(b.license_template_ready,false)) AS entitlement_ready_eff
  FROM base b
)
SELECT package_id, package_key, package_title, curriculum_id, product_id, course_id, package_status, track,
  published, sellable,
  delivery_ready_eff AS delivery_ready, entitlement_ready_eff AS entitlement_ready,
  tutor_ready_eff AS tutor_ready, exam_pool_ready_eff AS exam_pool_ready,
  (published AND sellable AND delivery_ready_eff AND entitlement_ready_eff AND tutor_ready_eff AND exam_pool_ready_eff) AS customer_safe,
  array_remove(ARRAY[
    CASE WHEN NOT published THEN 'NOT_PUBLISHED' END,
    CASE WHEN NOT sellable THEN 'NOT_SELLABLE:'||COALESCE(gap_class,'unknown') END,
    CASE WHEN NOT delivery_ready_eff THEN 'NOT_DELIVERY_READY' END,
    CASE WHEN NOT entitlement_ready_eff THEN 'NOT_ENTITLEMENT_READY' END,
    CASE WHEN NOT tutor_ready_eff THEN 'NOT_TUTOR_READY' END,
    CASE WHEN NOT exam_pool_ready_eff THEN 'NOT_EXAM_POOL_READY' END
  ], NULL) AS missing_dimensions,
  gap_class, delivery_blocking_reasons, commerce_gate_state, post_publish_state,
  jsonb_build_object(
    'product_public', product_public, 'has_stripe_price', has_stripe_price, 'license_template_ready', license_template_ready,
    'tutor_context_ready', tutor_context_ready, 'exam_trainer_ready', exam_trainer_ready, 'delivery_caps', delivery_caps
  ) AS sub_flags
FROM flagged;
REVOKE ALL ON public.v_package_customer_safe_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_package_customer_safe_v1 TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_delivery_matrix_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT has_role(v_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'generated_at', now(),
    'by_track', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'track', t.track, 'packages', t.packages, 'delivery_ready_v2', t.dr,
        'exam_pool_ok', t.exam_ok, 'tutor_ok', t.tutor_ok, 'oral_ok', t.oral_ok,
        'minichecks_ok', t.mc_ok, 'h5p_ok', t.h5p_ok, 'storage_ok', t.storage_ok, 'caps', t.caps
      ) ORDER BY t.track)
      FROM (
        SELECT COALESCE(track,'UNKNOWN') AS track, COUNT(*) AS packages,
          SUM(delivery_ready_v2::int) AS dr, SUM(cap_exam_pool_ok::int) AS exam_ok,
          SUM(cap_tutor_ok::int) AS tutor_ok, SUM(cap_oral_ok::int) AS oral_ok,
          SUM(cap_minichecks_ok::int) AS mc_ok, SUM(cap_h5p_ok::int) AS h5p_ok,
          SUM(cap_storage_ok::int) AS storage_ok, MAX(caps) AS caps
        FROM v_package_delivery_readiness_v2 WHERE package_status='published'
        GROUP BY COALESCE(track,'UNKNOWN')
      ) t
    ),'[]'::jsonb),
    'total_published', (SELECT COUNT(*) FROM v_package_delivery_readiness_v2 WHERE package_status='published'),
    'total_delivery_ready_v2', (SELECT COUNT(*) FROM v_package_delivery_readiness_v2 WHERE package_status='published' AND delivery_ready_v2)
  ) INTO v_result;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.admin_get_delivery_matrix_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_delivery_matrix_summary() TO authenticated;
