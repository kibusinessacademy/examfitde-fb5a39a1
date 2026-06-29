
-- BLUEPRINT.VARIANT.DIAGNOSTIC.1 (read-only)
-- Creates:
--   1) v_blueprint_variant_diagnostic (per-course rollup, all active courses)
--   2) blueprint_variant_diagnostic_snapshots (audit ledger)
--   3) admin_blueprint_variant_diagnostic_snapshot() RPC (admin-only, writes a snapshot)
--   4) admin_blueprint_variant_diagnostic_summary() RPC (bucket counts)
-- Does NOT mutate package_steps / blueprints / variants. Pure read.

CREATE OR REPLACE VIEW public.v_blueprint_variant_diagnostic AS
WITH course_pkg AS (
  SELECT
    c.id              AS course_id,
    c.title           AS course_title,
    c.status          AS course_status,
    c.curriculum_id   AS curriculum_id,
    cp.id             AS package_id,
    cp.title          AS package_title,
    cp.status         AS package_status,
    cp.published_at   AS published_at,
    cp.council_approved
  FROM public.courses c
  LEFT JOIN public.course_packages cp ON cp.course_id = c.id
  WHERE c.status::text = 'active'
),
eb_counts AS (
  SELECT curriculum_id, COUNT(*)::int AS eb_count, BOOL_OR(frozen) AS any_frozen
  FROM public.exam_blueprints
  GROUP BY curriculum_id
),
qb_counts AS (
  SELECT curriculum_id, COUNT(*)::int AS qb_count
  FROM public.question_blueprints
  GROUP BY curriculum_id
),
bv_counts AS (
  SELECT qb.curriculum_id,
         COUNT(bv.*)::int                                          AS bv_count,
         COUNT(*) FILTER (WHERE bv.validation_passed IS TRUE)::int AS bv_valid_count
  FROM public.question_blueprints qb
  LEFT JOIN public.blueprint_variants bv ON bv.blueprint_id = qb.id
  GROUP BY qb.curriculum_id
),
step_status AS (
  SELECT
    ps.package_id,
    MAX(CASE WHEN ps.step_key = 'auto_seed_exam_blueprints'  THEN ps.status::text END) AS step_seed_eb_status,
    MAX(CASE WHEN ps.step_key = 'generate_blueprint_variants' THEN ps.status::text END) AS step_gen_variants_status,
    MAX(CASE WHEN ps.step_key = 'validate_blueprint_variants' THEN ps.status::text END) AS step_val_variants_status,
    MAX(CASE WHEN ps.step_key = 'promote_blueprint_variants'  THEN ps.status::text END) AS step_promote_variants_status
  FROM public.package_steps ps
  GROUP BY ps.package_id
)
SELECT
  cp.course_id,
  cp.course_title,
  cp.course_status,
  cp.curriculum_id,
  cp.package_id,
  cp.package_title,
  cp.package_status,
  cp.published_at,
  cp.council_approved,
  COALESCE(eb.eb_count, 0)        AS exam_blueprints_count,
  COALESCE(eb.any_frozen, FALSE)  AS exam_blueprints_any_frozen,
  COALESCE(qb.qb_count, 0)        AS question_blueprints_count,
  COALESCE(bv.bv_count, 0)        AS blueprint_variants_count,
  COALESCE(bv.bv_valid_count, 0)  AS blueprint_variants_valid_count,
  ss.step_seed_eb_status,
  ss.step_gen_variants_status,
  ss.step_val_variants_status,
  ss.step_promote_variants_status,
  -- Bucketing (mutually exclusive, evaluated top-down)
  CASE
    WHEN cp.package_id IS NULL
      THEN 'manual_review_required'                       -- active course without package
    WHEN COALESCE(eb.eb_count,0) = 0
      THEN 'missing_exam_blueprints'
    WHEN COALESCE(qb.qb_count,0) = 0
      THEN 'missing_question_blueprints'
    WHEN COALESCE(bv.bv_count,0) = 0
         AND ss.step_gen_variants_status = 'done'
      THEN 'step_done_but_no_variants'
    WHEN COALESCE(bv.bv_count,0) = 0
         AND (ss.step_gen_variants_status IS NULL
              OR ss.step_gen_variants_status IN ('queued','pending','dormant','blocked','failed','skipped'))
      THEN 'step_queued_or_never_created'
    WHEN COALESCE(bv.bv_count,0) = 0
      THEN 'missing_variants_only'
    WHEN COALESCE(bv.bv_count,0) > 0
         AND COALESCE(qb.qb_count,0) > 0
         AND COALESCE(eb.eb_count,0) > 0
      THEN 'eligible_for_cut_c'
    ELSE 'manual_review_required'
  END AS bucket,
  -- Blocker hint (single short code)
  CASE
    WHEN cp.package_id IS NULL                                     THEN 'NO_PACKAGE'
    WHEN COALESCE(eb.eb_count,0) = 0                               THEN 'NO_EXAM_BLUEPRINTS'
    WHEN COALESCE(qb.qb_count,0) = 0                               THEN 'NO_QUESTION_BLUEPRINTS'
    WHEN COALESCE(bv.bv_count,0) = 0
         AND ss.step_gen_variants_status = 'done'                  THEN 'STEP_DONE_OUTPUT_MISSING'
    WHEN COALESCE(bv.bv_count,0) = 0
         AND ss.step_gen_variants_status = 'failed'                THEN 'STEP_FAILED'
    WHEN COALESCE(bv.bv_count,0) = 0
         AND ss.step_gen_variants_status IS NULL                   THEN 'STEP_NEVER_CREATED'
    WHEN COALESCE(bv.bv_count,0) = 0                               THEN 'STEP_NOT_DONE'
    ELSE NULL
  END AS blocker_code
FROM course_pkg cp
LEFT JOIN eb_counts   eb ON eb.curriculum_id = cp.curriculum_id
LEFT JOIN qb_counts   qb ON qb.curriculum_id = cp.curriculum_id
LEFT JOIN bv_counts   bv ON bv.curriculum_id = cp.curriculum_id
LEFT JOIN step_status ss ON ss.package_id    = cp.package_id;

GRANT SELECT ON public.v_blueprint_variant_diagnostic TO authenticated;
GRANT ALL    ON public.v_blueprint_variant_diagnostic TO service_role;

-- ---- Audit snapshot ledger ----
CREATE TABLE IF NOT EXISTS public.blueprint_variant_diagnostic_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at     timestamptz NOT NULL DEFAULT now(),
  taken_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  total_rows   int  NOT NULL,
  bucket_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.blueprint_variant_diagnostic_snapshots TO authenticated;
GRANT ALL ON public.blueprint_variant_diagnostic_snapshots TO service_role;

ALTER TABLE public.blueprint_variant_diagnostic_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bv_diag_snapshots_admin_select"
  ON public.blueprint_variant_diagnostic_snapshots
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "bv_diag_snapshots_admin_insert"
  ON public.blueprint_variant_diagnostic_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---- RPCs ----
CREATE OR REPLACE FUNCTION public.admin_blueprint_variant_diagnostic_summary()
RETURNS TABLE(bucket text, n int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bucket, COUNT(*)::int AS n
  FROM public.v_blueprint_variant_diagnostic
  GROUP BY bucket
  ORDER BY n DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_blueprint_variant_diagnostic_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_blueprint_variant_diagnostic_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_blueprint_variant_diagnostic_snapshot()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_total int;
  v_buckets jsonb;
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT COUNT(*)::int,
         COALESCE(jsonb_object_agg(bucket, n), '{}'::jsonb)
  INTO   v_total, v_buckets
  FROM (
    SELECT bucket, COUNT(*)::int AS n
    FROM public.v_blueprint_variant_diagnostic
    GROUP BY bucket
  ) s;

  INSERT INTO public.blueprint_variant_diagnostic_snapshots(taken_by, total_rows, bucket_counts, meta)
  VALUES (
    v_uid,
    (SELECT COUNT(*)::int FROM public.v_blueprint_variant_diagnostic),
    v_buckets,
    jsonb_build_object('source','BLUEPRINT.VARIANT.DIAGNOSTIC.1','readonly',true)
  )
  RETURNING id INTO v_id;

  -- Audit
  BEGIN
    PERFORM public.fn_emit_audit(
      'blueprint_variant_diagnostic_snapshot',
      jsonb_build_object('snapshot_id', v_id, 'bucket_counts', v_buckets, 'actor', v_uid)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_blueprint_variant_diagnostic_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_blueprint_variant_diagnostic_snapshot() TO authenticated;

NOTIFY pgrst, 'reload schema';
