
-- ============================================================
-- ops_curriculum_quality_dashboard: per-curriculum quality SSOT
-- ============================================================

CREATE OR REPLACE VIEW public.ops_curriculum_quality_dashboard AS
WITH
-- 1) Blueprint KPIs per curriculum (computed from question_blueprints directly)
blueprint_kpis AS (
  SELECT
    qb.curriculum_id,
    COUNT(*) AS total_blueprints,
    COUNT(*) FILTER (WHERE qb.status = 'approved') AS approved_blueprints,
    CASE WHEN COUNT(*) > 0
      THEN ROUND(100.0 * COUNT(*) FILTER (WHERE qb.status = 'approved') / COUNT(*), 1)
      ELSE 0
    END AS blueprint_approval_rate_pct,
    -- Bloom coverage: distinct cognitive_levels covered
    COUNT(DISTINCT qb.cognitive_level) AS bloom_levels_covered,
    -- Elite metrics from blueprints (via blueprint_variants or direct)
    ROUND(AVG(CASE WHEN qb.status = 'approved' AND qb.exam_relevance_score IS NOT NULL
      THEN qb.exam_relevance_score ELSE NULL END), 1) AS avg_exam_relevance_score
  FROM public.question_blueprints qb
  WHERE qb.curriculum_id IS NOT NULL
  GROUP BY 1
),

-- 2) Competency coverage by blueprints per curriculum
competency_coverage AS (
  SELECT
    lf.curriculum_id,
    COUNT(DISTINCT comp.id) AS competencies_total,
    COUNT(DISTINCT comp.id) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.question_blueprints qb
        WHERE qb.competency_id = comp.id AND qb.status = 'approved'
      )
    ) AS competencies_with_blueprint,
    CASE WHEN COUNT(DISTINCT comp.id) > 0
      THEN ROUND(100.0 * COUNT(DISTINCT comp.id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM public.question_blueprints qb
          WHERE qb.competency_id = comp.id AND qb.status = 'approved'
        )
      ) / COUNT(DISTINCT comp.id), 1)
      ELSE 0
    END AS blueprint_coverage_pct
  FROM public.learning_fields lf
  JOIN public.competencies comp ON comp.learning_field_id = lf.id
  GROUP BY 1
),

-- 3) Package health per curriculum
package_rollup AS (
  SELECT
    cp.curriculum_id,
    COUNT(*) AS packages_total,
    COUNT(*) FILTER (WHERE cp.status = 'published') AS packages_published,
    COUNT(*) FILTER (WHERE cp.status = 'quality_gate_failed') AS packages_qg_failed,
    COUNT(*) FILTER (WHERE cp.published_at IS NOT NULL) AS packages_with_published_at,
    COUNT(*) FILTER (WHERE cp.track = 'AUSBILDUNG_VOLL') AS pkg_full_cnt,
    COUNT(*) FILTER (WHERE cp.track = 'EXAM_FIRST') AS pkg_examfirst_cnt,
    COUNT(*) FILTER (WHERE cp.integrity_passed = true) AS pkg_integrity_passed,
    COUNT(*) FILTER (WHERE cp.integrity_passed = false) AS pkg_integrity_failed,
    COUNT(*) FILTER (WHERE cp.integrity_report IS NULL) AS pkg_null_reports,
    COUNT(*) FILTER (WHERE (cp.integrity_report->>'legacy_report') = 'true') AS pkg_legacy_reports,
    AVG(NULLIF((cp.integrity_report->>'total_score')::numeric, 0)) AS avg_total_score,
    AVG(NULLIF((cp.integrity_report->>'exam_score')::numeric, 0)) AS avg_exam_score,
    MAX(cp.updated_at) AS packages_last_update
  FROM public.course_packages cp
  WHERE cp.curriculum_id IS NOT NULL
  GROUP BY 1
),

-- 4) Exam question pool per curriculum
exam_pool AS (
  SELECT
    q.curriculum_id,
    COUNT(*) FILTER (WHERE q.status = 'approved') AS approved_questions,
    COUNT(*) FILTER (WHERE q.status = 'approved' AND q.difficulty = 'easy') AS q_easy,
    COUNT(*) FILTER (WHERE q.status = 'approved' AND q.difficulty = 'medium') AS q_medium,
    COUNT(*) FILTER (WHERE q.status = 'approved' AND q.difficulty = 'hard') AS q_hard,
    COUNT(*) FILTER (WHERE q.status = 'approved' AND q.difficulty = 'very_hard') AS q_very_hard,
    CASE WHEN COUNT(*) FILTER (WHERE q.status = 'approved') > 0
      THEN ROUND(100.0 * COUNT(*) FILTER (WHERE q.status = 'approved' AND q.difficulty IN ('hard','very_hard'))
        / COUNT(*) FILTER (WHERE q.status = 'approved'), 1)
      ELSE NULL
    END AS hardish_pct,
    CASE WHEN COUNT(*) FILTER (WHERE q.status = 'approved') > 0
      THEN ROUND(100.0 * COUNT(*) FILTER (WHERE q.status = 'approved' AND q.difficulty = 'easy')
        / COUNT(*) FILTER (WHERE q.status = 'approved'), 1)
      ELSE NULL
    END AS easy_pct,
    -- Bloom distribution
    COUNT(*) FILTER (WHERE q.status = 'approved' AND q.cognitive_level = 'remember') AS bloom_remember,
    COUNT(*) FILTER (WHERE q.status = 'approved' AND q.cognitive_level = 'understand') AS bloom_understand,
    COUNT(*) FILTER (WHERE q.status = 'approved' AND q.cognitive_level = 'apply') AS bloom_apply,
    COUNT(*) FILTER (WHERE q.status = 'approved' AND q.cognitive_level = 'analyze') AS bloom_analyze,
    COUNT(*) FILTER (WHERE q.status = 'approved' AND q.cognitive_level = 'evaluate') AS bloom_evaluate,
    COUNT(*) FILTER (WHERE q.status = 'approved' AND q.cognitive_level = 'create') AS bloom_create
  FROM public.exam_questions q
  WHERE q.curriculum_id IS NOT NULL
  GROUP BY 1
),

-- 5) Enrichment rollup per curriculum
enrichment_rollup AS (
  SELECT
    lf.curriculum_id,
    COUNT(comp.*) AS competencies_total,
    COUNT(comp.*) FILTER (WHERE COALESCE(comp.enrichment_version, 0) >= 2) AS competencies_enriched_v2,
    CASE WHEN COUNT(comp.*) > 0
      THEN ROUND(100.0 * COUNT(comp.*) FILTER (WHERE COALESCE(comp.enrichment_version, 0) >= 2) / COUNT(comp.*), 1)
      ELSE 0
    END AS enrichment_v2_pct
  FROM public.learning_fields lf
  JOIN public.competencies comp ON comp.learning_field_id = lf.id
  GROUP BY 1
)

SELECT
  cu.id AS curriculum_id,
  cu.title AS curriculum_title,
  cu.status AS curriculum_status,
  cu.track AS curriculum_track,
  cu.updated_at AS curriculum_updated_at,

  -- Blueprint KPIs
  COALESCE(bk.total_blueprints, 0) AS total_blueprints,
  COALESCE(bk.approved_blueprints, 0) AS approved_blueprints,
  COALESCE(bk.blueprint_approval_rate_pct, 0) AS blueprint_approval_rate_pct,
  bk.bloom_levels_covered,
  bk.avg_exam_relevance_score,

  -- Competency coverage
  COALESCE(cc.competencies_total, 0) AS competencies_total,
  COALESCE(cc.competencies_with_blueprint, 0) AS competencies_with_blueprint,
  COALESCE(cc.blueprint_coverage_pct, 0) AS blueprint_coverage_pct,

  -- Package rollup
  COALESCE(pr.packages_total, 0) AS packages_total,
  COALESCE(pr.packages_published, 0) AS packages_published,
  COALESCE(pr.packages_qg_failed, 0) AS packages_qg_failed,
  COALESCE(pr.packages_with_published_at, 0) AS packages_with_published_at,
  COALESCE(pr.pkg_full_cnt, 0) AS pkg_full_cnt,
  COALESCE(pr.pkg_examfirst_cnt, 0) AS pkg_examfirst_cnt,
  COALESCE(pr.pkg_integrity_passed, 0) AS pkg_integrity_passed,
  COALESCE(pr.pkg_integrity_failed, 0) AS pkg_integrity_failed,
  COALESCE(pr.pkg_null_reports, 0) AS pkg_null_reports,
  COALESCE(pr.pkg_legacy_reports, 0) AS pkg_legacy_reports,
  pr.avg_total_score,
  pr.avg_exam_score,
  pr.packages_last_update,

  -- Exam pool
  COALESCE(ep.approved_questions, 0) AS approved_questions,
  COALESCE(ep.q_easy, 0) AS q_easy,
  COALESCE(ep.q_medium, 0) AS q_medium,
  COALESCE(ep.q_hard, 0) AS q_hard,
  COALESCE(ep.q_very_hard, 0) AS q_very_hard,
  ep.easy_pct,
  ep.hardish_pct,
  COALESCE(ep.bloom_remember, 0) AS bloom_remember,
  COALESCE(ep.bloom_understand, 0) AS bloom_understand,
  COALESCE(ep.bloom_apply, 0) AS bloom_apply,
  COALESCE(ep.bloom_analyze, 0) AS bloom_analyze,
  COALESCE(ep.bloom_evaluate, 0) AS bloom_evaluate,
  COALESCE(ep.bloom_create, 0) AS bloom_create,

  -- Enrichment
  COALESCE(en.competencies_total, 0) AS enrichment_competencies_total,
  COALESCE(en.competencies_enriched_v2, 0) AS enrichment_competencies_v2,
  COALESCE(en.enrichment_v2_pct, 0) AS enrichment_v2_pct

FROM public.curricula cu
LEFT JOIN blueprint_kpis bk ON bk.curriculum_id = cu.id
LEFT JOIN competency_coverage cc ON cc.curriculum_id = cu.id
LEFT JOIN package_rollup pr ON pr.curriculum_id = cu.id
LEFT JOIN exam_pool ep ON ep.curriculum_id = cu.id
LEFT JOIN enrichment_rollup en ON en.curriculum_id = cu.id;

-- ============================================================
-- Materialized View + Indexes for Admin performance
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS public.ops_curriculum_quality_dashboard_mv;

CREATE MATERIALIZED VIEW public.ops_curriculum_quality_dashboard_mv AS
SELECT * FROM public.ops_curriculum_quality_dashboard;

CREATE UNIQUE INDEX ops_curriculum_quality_dashboard_mv_pk
  ON public.ops_curriculum_quality_dashboard_mv (curriculum_id);

CREATE INDEX ops_curriculum_quality_dashboard_mv_qg_idx
  ON public.ops_curriculum_quality_dashboard_mv (packages_qg_failed);

CREATE INDEX ops_curriculum_quality_dashboard_mv_score_idx
  ON public.ops_curriculum_quality_dashboard_mv (avg_total_score);

-- ============================================================
-- RPC: Refresh MV (for nightly cron)
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_curriculum_quality_dashboard_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.ops_curriculum_quality_dashboard_mv;
END;
$$;
