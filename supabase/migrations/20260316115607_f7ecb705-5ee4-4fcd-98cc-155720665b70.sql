
-- ============================================================
-- Package Readiness SSOT Reporting Views
-- ============================================================

-- 1) ops_package_readiness: Master view per package
CREATE OR REPLACE VIEW public.ops_package_readiness AS
WITH lesson_stats AS (
  SELECT
    cp.id AS package_id,
    COUNT(l.id) AS total_lessons,
    COUNT(l.id) FILTER (
      WHERE l.content IS NOT NULL
        AND l.content::text != 'null'
        AND l.content::text NOT LIKE '%_placeholder%'
        AND LENGTH(l.content::text) > 500
    ) AS real_lessons,
    COUNT(l.id) FILTER (
      WHERE l.content IS NULL
        OR l.content::text = 'null'
        OR l.content::text LIKE '%_placeholder%'
        OR LENGTH(l.content::text) <= 500
    ) AS placeholder_lessons,
    -- QC breakdown
    COUNT(l.id) FILTER (WHERE l.qc_status = 'approved') AS qc_approved,
    COUNT(l.id) FILTER (WHERE l.qc_status = 'tier1_passed') AS qc_tier1_passed,
    COUNT(l.id) FILTER (WHERE l.qc_status = 'tier1_failed') AS qc_tier1_failed,
    COUNT(l.id) FILTER (WHERE l.qc_status = 'needs_revision') AS qc_needs_revision,
    COUNT(l.id) FILTER (WHERE l.qc_status IS NULL) AS qc_pending,
    -- Exam risk coverage (marker-based)
    COUNT(l.id) FILTER (
      WHERE l.content IS NOT NULL
        AND l.content::text != 'null'
        AND l.content::text NOT LIKE '%_placeholder%'
        AND LENGTH(l.content::text) > 500
        AND (
          l.content::text ~* '(⚠|Prüfungsfalle|typische Falle|häufiger Fehler|klassischer Fehler|Achtung:)'
          OR l.content::text ~* '(Denkfehler|Fehlvorstellung|Missverständnis|häufig missverstanden|oft verwechselt|Verwechslung)'
          OR l.content::text ~* '(unvollständig|Teilpunkte|nicht ausreichend|nur teilweise richtig|wichtiger Aspekt fehlt)'
          OR l.content::text ~* '(in der Praxis.*aber in der Prüfung|im Betrieb.*aber in der Prüfung|Praxis.*Prüfung|betriebliche Routine|prüfungsrelevant ist dagegen)'
        )
    ) AS exam_risk_covered,
    -- Step completeness: count distinct steps with real content per competency
    COUNT(DISTINCT (l.competency_id, l.step)) FILTER (
      WHERE l.content IS NOT NULL
        AND l.content::text != 'null'
        AND l.content::text NOT LIKE '%_placeholder%'
        AND LENGTH(l.content::text) > 500
        AND l.competency_id IS NOT NULL
    ) AS real_competency_steps,
    COUNT(DISTINCT l.competency_id) FILTER (
      WHERE l.competency_id IS NOT NULL
    ) AS total_competencies,
    -- 5 steps per competency = full coverage
    COUNT(DISTINCT (l.competency_id, l.step)) FILTER (
      WHERE l.competency_id IS NOT NULL
    ) AS total_competency_steps
  FROM course_packages cp
  JOIN courses c ON cp.course_id = c.id
  JOIN modules m ON m.course_id = c.id
  JOIN lessons l ON l.module_id = m.id
  WHERE cp.archived IS NOT TRUE
  GROUP BY cp.id
)
SELECT
  cp.id AS package_id,
  cp.title AS package_title,
  cp.status,
  cp.priority,
  cp.build_progress,
  cp.integrity_passed,
  cp.council_approved,
  cp.is_published,
  cp.blocked_reason,
  cp.curriculum_id,
  ls.total_lessons,
  ls.real_lessons,
  ls.placeholder_lessons,
  CASE WHEN ls.total_lessons > 0
    THEN ROUND(100.0 * ls.real_lessons / ls.total_lessons, 1)
    ELSE 0
  END AS materialization_pct,
  ls.qc_approved,
  ls.qc_tier1_passed,
  ls.qc_tier1_failed,
  ls.qc_needs_revision,
  ls.qc_pending,
  CASE WHEN ls.real_lessons > 0
    THEN ROUND(100.0 * ls.qc_approved / ls.real_lessons, 1)
    ELSE 0
  END AS qc_approved_pct,
  ls.exam_risk_covered,
  CASE WHEN ls.real_lessons > 0
    THEN ROUND(100.0 * ls.exam_risk_covered / ls.real_lessons, 1)
    ELSE 0
  END AS exam_risk_coverage_pct,
  ls.total_competencies,
  ls.total_competency_steps,
  ls.real_competency_steps,
  CASE WHEN ls.total_competency_steps > 0
    THEN ROUND(100.0 * ls.real_competency_steps / ls.total_competency_steps, 1)
    ELSE 0
  END AS learner_step_completeness_pct,
  -- Readiness score: weighted composite
  CASE WHEN ls.total_lessons > 0 THEN
    ROUND(
      (0.35 * COALESCE(100.0 * ls.real_lessons / NULLIF(ls.total_lessons, 0), 0))
      + (0.25 * COALESCE(100.0 * ls.qc_approved / NULLIF(ls.real_lessons, 0), 0))
      + (0.20 * COALESCE(100.0 * ls.exam_risk_covered / NULLIF(ls.real_lessons, 0), 0))
      + (0.20 * COALESCE(100.0 * ls.real_competency_steps / NULLIF(ls.total_competency_steps, 0), 0))
    , 1)
  ELSE 0 END AS readiness_score,
  -- Readiness band
  CASE
    WHEN ls.total_lessons = 0 THEN 'empty'
    WHEN (100.0 * ls.real_lessons / ls.total_lessons) >= 90
      AND (100.0 * COALESCE(ls.qc_approved, 0) / NULLIF(ls.real_lessons, 0)) >= 70
      AND (100.0 * COALESCE(ls.real_competency_steps, 0) / NULLIF(ls.total_competency_steps, 0)) >= 90
    THEN 'learner_ready'
    WHEN (100.0 * ls.real_lessons / ls.total_lessons) >= 60
    THEN 'content_heavy'
    WHEN (100.0 * ls.real_lessons / ls.total_lessons) >= 20
    THEN 'building'
    ELSE 'early'
  END AS readiness_band,
  cp.updated_at
FROM course_packages cp
LEFT JOIN lesson_stats ls ON ls.package_id = cp.id
WHERE cp.archived IS NOT TRUE;

-- 2) ops_package_step_readiness: Per-package per-step drilldown
CREATE OR REPLACE VIEW public.ops_package_step_readiness AS
SELECT
  cp.id AS package_id,
  cp.title AS package_title,
  l.step AS lesson_step,
  COUNT(l.id) AS total_lessons,
  COUNT(l.id) FILTER (
    WHERE l.content IS NOT NULL
      AND l.content::text != 'null'
      AND l.content::text NOT LIKE '%_placeholder%'
      AND LENGTH(l.content::text) > 500
  ) AS real_lessons,
  COUNT(l.id) FILTER (
    WHERE l.content IS NULL
      OR l.content::text = 'null'
      OR l.content::text LIKE '%_placeholder%'
      OR LENGTH(l.content::text) <= 500
  ) AS placeholder_lessons,
  COUNT(l.id) FILTER (WHERE l.qc_status = 'approved') AS qc_approved,
  COUNT(l.id) FILTER (WHERE l.qc_status = 'tier1_passed') AS qc_tier1_passed,
  COUNT(l.id) FILTER (WHERE l.qc_status = 'tier1_failed') AS qc_tier1_failed,
  COUNT(l.id) FILTER (WHERE l.qc_status IS NULL) AS qc_pending,
  CASE WHEN COUNT(l.id) > 0
    THEN ROUND(100.0 * COUNT(l.id) FILTER (
      WHERE l.content IS NOT NULL
        AND l.content::text != 'null'
        AND l.content::text NOT LIKE '%_placeholder%'
        AND LENGTH(l.content::text) > 500
    ) / COUNT(l.id), 1)
    ELSE 0
  END AS materialization_pct
FROM course_packages cp
JOIN courses c ON cp.course_id = c.id
JOIN modules m ON m.course_id = c.id
JOIN lessons l ON l.module_id = m.id
WHERE cp.archived IS NOT TRUE
GROUP BY cp.id, cp.title, l.step;

-- 3) ops_package_blockers: Top blockers per package
CREATE OR REPLACE VIEW public.ops_package_blockers AS
WITH readiness AS (
  SELECT * FROM ops_package_readiness
  WHERE total_lessons > 0
)
SELECT
  r.package_id,
  r.package_title,
  r.status,
  r.priority,
  r.readiness_band,
  r.readiness_score,
  r.materialization_pct,
  r.qc_approved_pct,
  r.exam_risk_coverage_pct,
  r.learner_step_completeness_pct,
  r.blocked_reason,
  -- Blocker flags
  (r.materialization_pct < 50) AS blocker_placeholder_heavy,
  (r.qc_approved_pct < 30) AS blocker_qc_bottleneck,
  (r.learner_step_completeness_pct < 80) AS blocker_step_incomplete,
  (r.exam_risk_coverage_pct < 70) AS blocker_exam_risk_low,
  (r.blocked_reason IS NOT NULL AND r.blocked_reason != '') AS blocker_pipeline_blocked,
  -- Blocker count
  (
    CASE WHEN r.materialization_pct < 50 THEN 1 ELSE 0 END
    + CASE WHEN r.qc_approved_pct < 30 THEN 1 ELSE 0 END
    + CASE WHEN r.learner_step_completeness_pct < 80 THEN 1 ELSE 0 END
    + CASE WHEN r.exam_risk_coverage_pct < 70 THEN 1 ELSE 0 END
    + CASE WHEN r.blocked_reason IS NOT NULL AND r.blocked_reason != '' THEN 1 ELSE 0 END
  ) AS blocker_count
FROM readiness r;

-- Grant read access
GRANT SELECT ON public.ops_package_readiness TO anon, authenticated;
GRANT SELECT ON public.ops_package_step_readiness TO anon, authenticated;
GRANT SELECT ON public.ops_package_blockers TO anon, authenticated;
