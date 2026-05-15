
CREATE OR REPLACE VIEW public.v_exam_pool_lf_repair_gap_classification AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.curriculum_id, cp.status AS package_status
  FROM course_packages cp WHERE cp.curriculum_id IS NOT NULL
), lfs AS (
  SELECT p.package_id, p.curriculum_id, lf.id AS learning_field_id, lf.code AS lf_code, lf.sort_order
  FROM pkg p JOIN learning_fields lf ON lf.curriculum_id = p.curriculum_id
), bp_counts AS (
  SELECT qb.package_id, qb.learning_field_id,
         count(*) FILTER (WHERE qb.approved_at IS NOT NULL AND qb.deprecated_at IS NULL AND qb.status <> 'deprecated'::blueprint_status) AS approved_bp_count,
         count(*) AS total_bp_count
  FROM question_blueprints qb WHERE qb.learning_field_id IS NOT NULL
  GROUP BY qb.package_id, qb.learning_field_id
), var_counts AS (
  SELECT cp.id AS package_id, eqv.learning_field_id,
         count(*) FILTER (WHERE eqv.status = 'approved') AS usable_variant_count,
         count(*) FILTER (WHERE eqv.status = 'review')   AS review_variant_count,
         count(*) FILTER (WHERE eqv.status = 'rejected') AS rejected_variant_count,
         count(*) AS total_variant_count
  FROM exam_question_variants eqv
  JOIN course_packages cp ON cp.curriculum_id = eqv.curriculum_id
  WHERE eqv.learning_field_id IS NOT NULL
  GROUP BY cp.id, eqv.learning_field_id
), q_counts AS (
  SELECT eq.package_id, eq.learning_field_id,
         count(*) FILTER (WHERE eq.qc_status = 'approved'::text) AS approved_question_count,
         count(*) AS total_question_count
  FROM exam_questions eq WHERE eq.learning_field_id IS NOT NULL
  GROUP BY eq.package_id, eq.learning_field_id
)
SELECT
  l.package_id, l.curriculum_id, l.learning_field_id, l.lf_code, l.sort_order,
  COALESCE(b.approved_bp_count,0::bigint) AS approved_bp_count,
  COALESCE(b.total_bp_count,0::bigint) AS total_bp_count,
  COALESCE(v.usable_variant_count,0::bigint) AS usable_variant_count,
  COALESCE(q.approved_question_count,0::bigint) AS approved_question_count,
  COALESCE(q.total_question_count,0::bigint) AS total_question_count,
  15 AS target_per_lf,
  GREATEST(15 - COALESCE(q.approved_question_count,0::bigint), 0::bigint) AS question_deficit,
  CASE
    WHEN COALESCE(q.approved_question_count,0::bigint) >= 15 THEN 'OK'::text
    WHEN COALESCE(b.approved_bp_count,0::bigint) = 0 THEN 'BLUEPRINT_GAP'::text
    WHEN COALESCE(v.usable_variant_count,0::bigint) = 0 THEN 'VARIANT_GAP'::text
    ELSE 'QUESTION_GAP_ONLY'::text
  END AS gap_class,
  COALESCE(v.review_variant_count,0::bigint) AS review_variant_count,
  COALESCE(v.rejected_variant_count,0::bigint) AS rejected_variant_count,
  COALESCE(v.total_variant_count,0::bigint) AS total_variant_count,
  CASE
    WHEN COALESCE(v.usable_variant_count,0::bigint) = 0 AND COALESCE(v.review_variant_count,0::bigint) > 0 THEN 'AWAITING_APPROVAL'
    WHEN COALESCE(v.usable_variant_count,0::bigint) = 0 AND COALESCE(v.total_variant_count,0::bigint) = 0 THEN 'NO_MATERIAL'
    ELSE NULL
  END AS variant_pipeline_state
FROM lfs l
LEFT JOIN bp_counts b ON b.package_id=l.package_id AND b.learning_field_id=l.learning_field_id
LEFT JOIN var_counts v ON v.package_id=l.package_id AND v.learning_field_id=l.learning_field_id
LEFT JOIN q_counts q  ON q.package_id=l.package_id AND q.learning_field_id=l.learning_field_id;

INSERT INTO auto_heal_log(trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
VALUES ('manual_ops','lf_repair_gap_classification_view_fixed','v_exam_pool_lf_repair_gap_classification','view','success',
  'GATE_SOURCE_DRIFT fixed: usable_variant_count = exam_question_variants.status=approved (was: blueprint_variants.validation_passed=true / always 0). Added review_variant_count, rejected_variant_count, total_variant_count, variant_pipeline_state.',
  jsonb_build_object('subcode_resolved','LF_REPAIR_GATE_SOURCE_DRIFT','old_source','blueprint_variants','new_source','exam_question_variants','global_eqv_distribution',jsonb_build_object('review',255532,'approved',10146,'rejected',261)));
