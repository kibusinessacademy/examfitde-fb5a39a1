
-- =====================================================================
-- P74c Phase 1 — Diagnose-Freeze für fehlende Master Exam-Blueprints
-- =====================================================================

CREATE OR REPLACE VIEW public.v_missing_exam_blueprint_packages AS
WITH base AS (
  SELECT
    cp.id                AS package_id,
    cp.package_key,
    cp.title             AS package_title,
    cp.curriculum_id,
    cp.status            AS package_status,
    public.fn_is_bronze_locked(cp.id) AS bronze_locked
  FROM public.course_packages cp
  WHERE NOT EXISTS (
    SELECT 1 FROM public.exam_blueprints eb
    WHERE (eb.curriculum_id IS NOT NULL AND eb.curriculum_id = cp.curriculum_id)
       OR (eb.package_id    IS NOT NULL AND eb.package_id    = cp.id)
  )
),
qbp AS (
  SELECT b.package_id,
         COUNT(*) FILTER (WHERE qb.approved_at IS NOT NULL) AS approved_qbp_count,
         COUNT(*)                                            AS total_qbp_count
  FROM base b
  LEFT JOIN public.question_blueprints qb
    ON qb.curriculum_id = b.curriculum_id
   AND (qb.package_id = b.package_id OR qb.package_id IS NULL)
  GROUP BY b.package_id
),
inv AS (
  SELECT b.package_id,
         COUNT(*) AS variant_inventory_count
  FROM base b
  LEFT JOIN public.blueprint_variant_inventory bvi
    ON bvi.package_id = b.package_id
   OR  bvi.curriculum_id = b.curriculum_id
  GROUP BY b.package_id
),
eq AS (
  SELECT b.package_id,
         COUNT(*) FILTER (WHERE eq.status = 'approved') AS approved_questions
  FROM base b
  LEFT JOIN public.exam_questions eq ON eq.package_id = b.package_id
  GROUP BY b.package_id
),
fail AS (
  SELECT b.package_id,
         (ARRAY_AGG(ps.step_key ORDER BY ps.updated_at DESC))[1] AS latest_failed_step,
         (ARRAY_AGG(ps.last_error ORDER BY ps.updated_at DESC))[1] AS latest_failed_error
  FROM base b
  LEFT JOIN public.package_steps ps
    ON ps.package_id = b.package_id AND ps.status = 'failed'
  GROUP BY b.package_id
)
SELECT
  b.package_id,
  b.package_key,
  b.package_title,
  b.curriculum_id,
  b.package_status,
  b.bronze_locked,
  COALESCE(qbp.approved_qbp_count, 0)   AS approved_qbp_count,
  COALESCE(qbp.total_qbp_count, 0)      AS total_qbp_count,
  COALESCE(inv.variant_inventory_count, 0) AS variant_inventory_count,
  COALESCE(eq.approved_questions, 0)    AS approved_questions,
  fail.latest_failed_step,
  fail.latest_failed_error,
  CASE
    WHEN b.curriculum_id IS NULL THEN 'NO_CURRICULUM'
    WHEN COALESCE(qbp.approved_qbp_count, 0) = 0 THEN 'INSUFFICIENT'
    WHEN COALESCE(qbp.approved_qbp_count, 0) < 30 THEN 'LOW_QBP'
    ELSE 'READY'
  END AS recoverability_class
FROM base b
LEFT JOIN qbp  USING (package_id)
LEFT JOIN inv  USING (package_id)
LEFT JOIN eq   USING (package_id)
LEFT JOIN fail USING (package_id);

REVOKE ALL ON public.v_missing_exam_blueprint_packages FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_missing_exam_blueprint_packages TO service_role;

-- ---------------------------------------------------------------------
-- Admin-Summary-RPC (has_role-gated)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_missing_exam_blueprint_summary(
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary jsonb;
  v_rows    jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'total',                COUNT(*),
    'bronze_locked',        COUNT(*) FILTER (WHERE bronze_locked),
    'by_status', jsonb_build_object(
      'published', COUNT(*) FILTER (WHERE package_status = 'published'),
      'building',  COUNT(*) FILTER (WHERE package_status = 'building'),
      'queued',    COUNT(*) FILTER (WHERE package_status = 'queued'),
      'draft',     COUNT(*) FILTER (WHERE package_status = 'draft'),
      'blocked',   COUNT(*) FILTER (WHERE package_status = 'blocked')
    ),
    'by_recoverability', jsonb_build_object(
      'READY',          COUNT(*) FILTER (WHERE recoverability_class = 'READY'),
      'LOW_QBP',        COUNT(*) FILTER (WHERE recoverability_class = 'LOW_QBP'),
      'INSUFFICIENT',   COUNT(*) FILTER (WHERE recoverability_class = 'INSUFFICIENT'),
      'NO_CURRICULUM',  COUNT(*) FILTER (WHERE recoverability_class = 'NO_CURRICULUM')
    )
  )
  INTO v_summary
  FROM public.v_missing_exam_blueprint_packages;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY recoverability_class, approved_qbp_count DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT *
    FROM public.v_missing_exam_blueprint_packages
    ORDER BY
      CASE recoverability_class
        WHEN 'READY' THEN 1 WHEN 'LOW_QBP' THEN 2
        WHEN 'INSUFFICIENT' THEN 3 ELSE 4
      END,
      approved_qbp_count DESC
    LIMIT GREATEST(p_limit, 1)
  ) t;

  RETURN jsonb_build_object(
    'summary',  v_summary,
    'packages', v_rows,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_missing_exam_blueprint_summary(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_missing_exam_blueprint_summary(integer) TO authenticated, service_role;

COMMENT ON VIEW public.v_missing_exam_blueprint_packages IS
  'P74c Phase 1 SSOT: Pakete ohne Master exam_blueprints. Diagnose-only.';
COMMENT ON FUNCTION public.admin_get_missing_exam_blueprint_summary(integer) IS
  'P74c Phase 1 Admin-RPC: Summary + Top-Liste fehlender Master-Blueprints. has_role admin gated.';
