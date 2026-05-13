-- =========================================================
-- SSOT: LF Repair Gap Classification
-- Soll pro LF: 15 approved exam_questions
-- Klassen pro (package_id, learning_field_id):
--   BLUEPRINT_GAP    : 0 approved Blueprints
--   VARIANT_GAP      : >=1 approved BP, aber 0 usable variants
--   QUESTION_GAP_ONLY: BPs+Variants ok, aber approved questions < target
--   OK               : approved questions >= target
-- =========================================================

CREATE OR REPLACE VIEW public.v_exam_pool_lf_repair_gap_classification AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.curriculum_id, cp.status AS package_status
  FROM public.course_packages cp
  WHERE cp.curriculum_id IS NOT NULL
),
lfs AS (
  SELECT p.package_id, p.curriculum_id, lf.id AS learning_field_id, lf.code AS lf_code, lf.sort_order
  FROM pkg p
  JOIN public.learning_fields lf ON lf.curriculum_id = p.curriculum_id
),
bp_counts AS (
  SELECT
    qb.package_id,
    qb.learning_field_id,
    COUNT(*) FILTER (WHERE qb.approved_at IS NOT NULL AND qb.deprecated_at IS NULL AND qb.status <> 'deprecated') AS approved_bp_count,
    COUNT(*) AS total_bp_count
  FROM public.question_blueprints qb
  WHERE qb.learning_field_id IS NOT NULL
  GROUP BY qb.package_id, qb.learning_field_id
),
var_counts AS (
  SELECT
    qb.package_id,
    qb.learning_field_id,
    COUNT(bv.id) FILTER (WHERE bv.validation_passed = true) AS usable_variant_count
  FROM public.question_blueprints qb
  LEFT JOIN public.blueprint_variants bv ON bv.blueprint_id = qb.id
  WHERE qb.approved_at IS NOT NULL AND qb.deprecated_at IS NULL AND qb.status <> 'deprecated'
  GROUP BY qb.package_id, qb.learning_field_id
),
q_counts AS (
  SELECT
    eq.package_id,
    eq.learning_field_id,
    COUNT(*) FILTER (WHERE eq.qc_status = 'approved') AS approved_question_count,
    COUNT(*) AS total_question_count
  FROM public.exam_questions eq
  WHERE eq.learning_field_id IS NOT NULL
  GROUP BY eq.package_id, eq.learning_field_id
)
SELECT
  l.package_id,
  l.curriculum_id,
  l.learning_field_id,
  l.lf_code,
  l.sort_order,
  COALESCE(b.approved_bp_count, 0)        AS approved_bp_count,
  COALESCE(b.total_bp_count, 0)           AS total_bp_count,
  COALESCE(v.usable_variant_count, 0)     AS usable_variant_count,
  COALESCE(q.approved_question_count, 0)  AS approved_question_count,
  COALESCE(q.total_question_count, 0)     AS total_question_count,
  15                                      AS target_per_lf,
  GREATEST(15 - COALESCE(q.approved_question_count, 0), 0) AS question_deficit,
  CASE
    WHEN COALESCE(q.approved_question_count, 0) >= 15 THEN 'OK'
    WHEN COALESCE(b.approved_bp_count, 0) = 0       THEN 'BLUEPRINT_GAP'
    WHEN COALESCE(v.usable_variant_count, 0) = 0    THEN 'VARIANT_GAP'
    ELSE 'QUESTION_GAP_ONLY'
  END AS gap_class
FROM lfs l
LEFT JOIN bp_counts  b ON b.package_id = l.package_id AND b.learning_field_id = l.learning_field_id
LEFT JOIN var_counts v ON v.package_id = l.package_id AND v.learning_field_id = l.learning_field_id
LEFT JOIN q_counts   q ON q.package_id = l.package_id AND q.learning_field_id = l.learning_field_id;

COMMENT ON VIEW public.v_exam_pool_lf_repair_gap_classification IS
  'SSOT: Per-Package×LF gap classification (BLUEPRINT_GAP / VARIANT_GAP / QUESTION_GAP_ONLY / OK), target_per_lf=15.';

REVOKE ALL ON public.v_exam_pool_lf_repair_gap_classification FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_exam_pool_lf_repair_gap_classification TO service_role;

-- =========================================================
-- Per-Package Aggregat
-- =========================================================
CREATE OR REPLACE VIEW public.v_exam_pool_lf_repair_gap_summary AS
WITH per AS (
  SELECT * FROM public.v_exam_pool_lf_repair_gap_classification
),
agg AS (
  SELECT
    package_id,
    curriculum_id,
    COUNT(*)                                               AS lf_total,
    COUNT(*) FILTER (WHERE gap_class = 'OK')               AS lf_ok,
    COUNT(*) FILTER (WHERE gap_class = 'BLUEPRINT_GAP')    AS lf_blueprint_gap,
    COUNT(*) FILTER (WHERE gap_class = 'VARIANT_GAP')      AS lf_variant_gap,
    COUNT(*) FILTER (WHERE gap_class = 'QUESTION_GAP_ONLY') AS lf_question_gap_only,
    SUM(question_deficit)                                  AS total_question_deficit
  FROM per
  GROUP BY package_id, curriculum_id
)
SELECT
  a.package_id,
  a.curriculum_id,
  a.lf_total,
  a.lf_ok,
  a.lf_blueprint_gap,
  a.lf_variant_gap,
  a.lf_question_gap_only,
  a.total_question_deficit,
  CASE
    WHEN a.lf_blueprint_gap + a.lf_variant_gap + a.lf_question_gap_only = 0 THEN 'OK'
    WHEN (CASE WHEN a.lf_blueprint_gap > 0 THEN 1 ELSE 0 END
        + CASE WHEN a.lf_variant_gap > 0 THEN 1 ELSE 0 END
        + CASE WHEN a.lf_question_gap_only > 0 THEN 1 ELSE 0 END) > 1 THEN 'MIXED_GAP'
    WHEN a.lf_blueprint_gap > 0    THEN 'BLUEPRINT_GAP'
    WHEN a.lf_variant_gap > 0      THEN 'VARIANT_GAP'
    WHEN a.lf_question_gap_only> 0 THEN 'QUESTION_GAP_ONLY'
    ELSE 'OK'
  END AS package_gap_class
FROM agg a;

COMMENT ON VIEW public.v_exam_pool_lf_repair_gap_summary IS
  'SSOT: Aggregierte Gap-Klasse pro Paket (OK / BLUEPRINT_GAP / VARIANT_GAP / QUESTION_GAP_ONLY / MIXED_GAP).';

REVOKE ALL ON public.v_exam_pool_lf_repair_gap_summary FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_exam_pool_lf_repair_gap_summary TO service_role;

-- =========================================================
-- RPC: admin_get_exam_pool_lf_repair_gaps
--   Liefert Per-LF Detail-Rows + Per-Package Summary.
--   has_role-gated (admin/super_admin).
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_get_exam_pool_lf_repair_gaps(
  _package_ids uuid[] DEFAULT NULL,
  _only_problematic boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin boolean;
  _details  jsonb;
  _summary  jsonb;
BEGIN
  _is_admin := public.has_role(auth.uid(),'admin')
            OR public.has_role(auth.uid(),'super_admin');
  IF NOT COALESCE(_is_admin,false) THEN
    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE='42501';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.package_id, d.sort_order), '[]'::jsonb)
    INTO _details
  FROM (
    SELECT *
    FROM public.v_exam_pool_lf_repair_gap_classification c
    WHERE (_package_ids IS NULL OR c.package_id = ANY(_package_ids))
      AND (NOT _only_problematic OR c.gap_class <> 'OK')
  ) d;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.package_id), '[]'::jsonb)
    INTO _summary
  FROM (
    SELECT *
    FROM public.v_exam_pool_lf_repair_gap_summary s
    WHERE (_package_ids IS NULL OR s.package_id = ANY(_package_ids))
      AND (NOT _only_problematic OR s.package_gap_class <> 'OK')
  ) s;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'filter', jsonb_build_object(
      'package_ids', COALESCE(to_jsonb(_package_ids), 'null'::jsonb),
      'only_problematic', _only_problematic
    ),
    'summary_by_package', _summary,
    'details_per_lf',     _details
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_exam_pool_lf_repair_gaps(uuid[], boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_get_exam_pool_lf_repair_gaps(uuid[], boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_get_exam_pool_lf_repair_gaps(uuid[], boolean) IS
  'SSOT-RPC für LF-Repair-Gap-Diagnose. Liefert Per-LF-Klassifikation + Per-Package-Aggregat.';

-- =========================================================
-- Audit
-- =========================================================
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'lf_repair_gap_classification_view_created',
  'system',
  'success',
  jsonb_build_object(
    'views', jsonb_build_array(
      'v_exam_pool_lf_repair_gap_classification',
      'v_exam_pool_lf_repair_gap_summary'
    ),
    'rpc', 'admin_get_exam_pool_lf_repair_gaps',
    'target_per_lf', 15,
    'classes', jsonb_build_array('OK','BLUEPRINT_GAP','VARIANT_GAP','QUESTION_GAP_ONLY','MIXED_GAP'),
    'note', 'SSOT-Diagnose vor Repair-Worker-Patch (Phase b)'
  )
);
