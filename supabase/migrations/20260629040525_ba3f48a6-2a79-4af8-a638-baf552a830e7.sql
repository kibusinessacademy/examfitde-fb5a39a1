
DROP VIEW IF EXISTS public.v_blueprint_variant_diagnostic;

CREATE VIEW public.v_blueprint_variant_diagnostic AS
WITH course_pkg AS (
  SELECT
    c.id              AS course_id,
    c.title           AS course_title,
    c.status::text    AS course_status,
    c.curriculum_id   AS curriculum_id,
    cp.id             AS package_id,
    cp.title          AS package_title,
    cp.status         AS package_status,
    cp.published_at   AS published_at,
    cp.council_approved
  FROM public.courses c
  LEFT JOIN public.course_packages cp ON cp.course_id = c.id
  WHERE c.status::text IN ('draft','generating','published')
),
eb_counts AS (
  SELECT curriculum_id, COUNT(*)::int AS eb_count, BOOL_OR(frozen) AS any_frozen
  FROM public.exam_blueprints GROUP BY curriculum_id
),
qb_counts AS (
  SELECT curriculum_id, COUNT(*)::int AS qb_count
  FROM public.question_blueprints GROUP BY curriculum_id
),
bv_counts AS (
  SELECT qb.curriculum_id,
         COUNT(bv.*)::int AS bv_count,
         COUNT(*) FILTER (WHERE bv.validation_passed IS TRUE)::int AS bv_valid_count
  FROM public.question_blueprints qb
  LEFT JOIN public.blueprint_variants bv ON bv.blueprint_id = qb.id
  GROUP BY qb.curriculum_id
),
step_status AS (
  SELECT
    ps.package_id,
    MAX(CASE WHEN ps.step_key = 'auto_seed_exam_blueprints'   THEN ps.status::text END) AS step_seed_eb_status,
    MAX(CASE WHEN ps.step_key = 'generate_blueprint_variants' THEN ps.status::text END) AS step_gen_variants_status,
    MAX(CASE WHEN ps.step_key = 'validate_blueprint_variants' THEN ps.status::text END) AS step_val_variants_status,
    MAX(CASE WHEN ps.step_key = 'promote_blueprint_variants'  THEN ps.status::text END) AS step_promote_variants_status
  FROM public.package_steps ps GROUP BY ps.package_id
)
SELECT
  cp.course_id, cp.course_title, cp.course_status, cp.curriculum_id,
  cp.package_id, cp.package_title, cp.package_status, cp.published_at, cp.council_approved,
  COALESCE(eb.eb_count, 0)       AS exam_blueprints_count,
  COALESCE(eb.any_frozen, FALSE) AS exam_blueprints_any_frozen,
  COALESCE(qb.qb_count, 0)       AS question_blueprints_count,
  COALESCE(bv.bv_count, 0)       AS blueprint_variants_count,
  COALESCE(bv.bv_valid_count, 0) AS blueprint_variants_valid_count,
  ss.step_seed_eb_status, ss.step_gen_variants_status,
  ss.step_val_variants_status, ss.step_promote_variants_status,
  CASE
    WHEN cp.package_id IS NULL                            THEN 'manual_review_required'
    WHEN COALESCE(eb.eb_count,0) = 0                      THEN 'missing_exam_blueprints'
    WHEN COALESCE(qb.qb_count,0) = 0                      THEN 'missing_question_blueprints'
    WHEN COALESCE(bv.bv_count,0) = 0 AND ss.step_gen_variants_status = 'done'
                                                          THEN 'step_done_but_no_variants'
    WHEN COALESCE(bv.bv_count,0) = 0
         AND (ss.step_gen_variants_status IS NULL
              OR ss.step_gen_variants_status IN ('queued','pending','dormant','blocked','failed','skipped'))
                                                          THEN 'step_queued_or_never_created'
    WHEN COALESCE(bv.bv_count,0) = 0                      THEN 'missing_variants_only'
    WHEN COALESCE(bv.bv_count,0) > 0
         AND COALESCE(qb.qb_count,0) > 0
         AND COALESCE(eb.eb_count,0) > 0                  THEN 'eligible_for_cut_c'
    ELSE 'manual_review_required'
  END AS bucket,
  CASE
    WHEN cp.package_id IS NULL                                THEN 'NO_PACKAGE'
    WHEN COALESCE(eb.eb_count,0) = 0                          THEN 'NO_EXAM_BLUEPRINTS'
    WHEN COALESCE(qb.qb_count,0) = 0                          THEN 'NO_QUESTION_BLUEPRINTS'
    WHEN COALESCE(bv.bv_count,0) = 0 AND ss.step_gen_variants_status = 'done'
                                                              THEN 'STEP_DONE_OUTPUT_MISSING'
    WHEN COALESCE(bv.bv_count,0) = 0 AND ss.step_gen_variants_status = 'failed'
                                                              THEN 'STEP_FAILED'
    WHEN COALESCE(bv.bv_count,0) = 0 AND ss.step_gen_variants_status IS NULL
                                                              THEN 'STEP_NEVER_CREATED'
    WHEN COALESCE(bv.bv_count,0) = 0                          THEN 'STEP_NOT_DONE'
    ELSE NULL
  END AS blocker_code
FROM course_pkg cp
LEFT JOIN eb_counts   eb ON eb.curriculum_id = cp.curriculum_id
LEFT JOIN qb_counts   qb ON qb.curriculum_id = cp.curriculum_id
LEFT JOIN bv_counts   bv ON bv.curriculum_id = cp.curriculum_id
LEFT JOIN step_status ss ON ss.package_id    = cp.package_id;

GRANT SELECT ON public.v_blueprint_variant_diagnostic TO authenticated;
GRANT ALL    ON public.v_blueprint_variant_diagnostic TO service_role;
NOTIFY pgrst, 'reload schema';
