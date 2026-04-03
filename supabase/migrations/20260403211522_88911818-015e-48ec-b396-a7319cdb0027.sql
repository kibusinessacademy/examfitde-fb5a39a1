CREATE OR REPLACE VIEW public.v_blueprint_variant_stats AS
SELECT
  bp.id AS blueprint_id,
  bp.name AS blueprint_name,
  bp.curriculum_id,
  bp.competency_id,
  bp.learning_field_id,
  bp.status AS blueprint_status,
  COUNT(v.id) AS total_variants,
  COUNT(v.id) FILTER (WHERE v.status = 'promoted') AS promoted,
  COUNT(v.id) FILTER (WHERE v.status = 'review') AS in_review,
  COUNT(v.id) FILTER (WHERE v.status = 'skipped') AS skipped,
  COALESCE(AVG(v.quality_score)::int, 0) AS avg_quality,
  COUNT(v.id) FILTER (WHERE v.variant_type = 'transfer_shift') AS transfer_count,
  COUNT(v.id) FILTER (WHERE v.variant_type = 'parameter_shift') AS parameter_count,
  COUNT(v.id) FILTER (WHERE v.variant_type = 'context_shift') AS context_count,
  COUNT(v.id) FILTER (WHERE v.variant_type = 'trap_shift') AS trap_count,
  COUNT(v.id) FILTER (WHERE v.variant_type = 'structure_shift') AS structure_count,
  CASE
    WHEN COUNT(v.id) = 0 THEN 0
    ELSE ROUND(COUNT(v.id) FILTER (WHERE v.variant_type = 'transfer_shift') * 100.0 / COUNT(v.id))::int
  END AS transfer_pct,
  CASE
    WHEN COUNT(v.id) = 0 THEN 'pending'
    WHEN COUNT(v.id) FILTER (WHERE v.variant_type = 'transfer_shift') * 100.0 / NULLIF(COUNT(v.id), 0) >= 20
         AND COUNT(v.id) FILTER (WHERE v.variant_type = 'parameter_shift') * 100.0 / NULLIF(COUNT(v.id), 0) <= 35
         AND COALESCE(AVG(v.quality_score), 0) >= 70
    THEN 'passed'
    ELSE 'failed'
  END AS gate_status
FROM question_blueprints bp
LEFT JOIN exam_question_variants v ON v.blueprint_id = bp.id
WHERE bp.status = 'approved'
GROUP BY bp.id, bp.name, bp.curriculum_id, bp.competency_id, bp.learning_field_id, bp.status;