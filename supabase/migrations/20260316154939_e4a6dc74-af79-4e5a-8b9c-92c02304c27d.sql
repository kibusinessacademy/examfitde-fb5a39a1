
-- Fix: Cap QC and minicheck scores at 100 in ops_artifact_build_progress
DROP VIEW IF EXISTS public.ops_artifact_build_progress;

CREATE VIEW public.ops_artifact_build_progress AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title, cp.status, cp.priority,
         cp.build_progress AS stored_progress, cp.curriculum_id, c.id AS course_id
  FROM course_packages cp JOIN courses c ON cp.course_id = c.id WHERE cp.archived IS NOT TRUE
),
met AS (
  SELECT p.package_id,
    CASE WHEN count(DISTINCT m.id) > 0 AND count(l.id) > 0 THEN 100 ELSE 0 END AS structure_score,
    CASE WHEN count(l.id) > 0 THEN least(round(100.0 * count(l.id) FILTER (WHERE l.content IS NOT NULL
      AND l.content::text <> 'null' AND l.content::text NOT LIKE '%_placeholder%'
      AND length(l.content::text) > 500) / count(l.id), 1), 100) ELSE 0 END AS content_score,
    CASE WHEN count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null'
      AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500) > 0
      THEN least(round(100.0 * count(l.id) FILTER (WHERE l.qc_status = 'approved') /
        nullif(count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null'
        AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500), 0), 1), 100)
      ELSE 0 END AS qc_score,
    CASE WHEN count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null'
      AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500) > 0
      THEN least(round(100.0 * count(l.id) FILTER (WHERE l.minicheck_parsed IS TRUE) /
        nullif(count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null'
        AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500), 0), 1), 100)
      ELSE 0 END AS minicheck_score
  FROM pkg p JOIN modules m ON m.course_id = p.course_id JOIN lessons l ON l.module_id = m.id
  GROUP BY p.package_id
),
es AS (
  SELECT p.package_id,
    least(round(100.0 * count(*) FILTER (WHERE eq.status = 'approved'::question_status) / 500.0, 1), 100) AS score
  FROM pkg p LEFT JOIN exam_questions eq ON eq.curriculum_id = p.curriculum_id GROUP BY p.package_id
),
hs AS (
  SELECT p.package_id,
    CASE WHEN count(s.id) FILTER (WHERE s.content_markdown IS NOT NULL AND length(s.content_markdown) > 100) > 0
      THEN least(round(100.0 * count(s.id) FILTER (WHERE s.content_markdown IS NOT NULL
        AND length(s.content_markdown) > 100) / greatest(count(s.id), 1), 1), 100)
      ELSE 0 END AS score
  FROM pkg p LEFT JOIN handbook_chapters hc ON hc.curriculum_id = p.curriculum_id
  LEFT JOIN handbook_sections s ON s.chapter_id = hc.id GROUP BY p.package_id
),
sc AS (
  SELECT ps.package_id,
    CASE WHEN count(*) > 0 THEN least(round(100.0 * count(*) FILTER (WHERE ps.status = 'done') / count(*), 1), 100) ELSE 0 END AS score
  FROM package_steps ps JOIN pkg p ON p.package_id = ps.package_id GROUP BY ps.package_id
),
computed AS (
  SELECT p.package_id, p.title, p.status, p.priority, p.stored_progress,
    round(
      0.10 * coalesce(met.structure_score, 0) + 0.25 * coalesce(met.content_score, 0) +
      0.15 * coalesce(met.qc_score, 0) + 0.10 * coalesce(met.minicheck_score, 0) +
      0.20 * coalesce(es.score, 0) + 0.10 * coalesce(hs.score, 0) + 0.10 * coalesce(sc.score, 0)
    , 1) AS real_progress,
    coalesce(met.structure_score, 0) AS structure_pct,
    coalesce(met.content_score, 0) AS content_pct,
    coalesce(met.qc_score, 0) AS qc_pct,
    coalesce(met.minicheck_score, 0) AS minicheck_pct,
    coalesce(es.score, 0) AS exam_pct,
    coalesce(hs.score, 0) AS handbook_pct,
    coalesce(sc.score, 0) AS steps_done_pct
  FROM pkg p LEFT JOIN met ON met.package_id = p.package_id LEFT JOIN es ON es.package_id = p.package_id
  LEFT JOIN hs ON hs.package_id = p.package_id LEFT JOIN sc ON sc.package_id = p.package_id
)
SELECT package_id, title AS package_title, status, priority, stored_progress, real_progress,
  stored_progress - real_progress AS progress_drift,
  structure_pct, content_pct, qc_pct, minicheck_pct, exam_pct, handbook_pct, steps_done_pct,
  CASE
    WHEN abs(stored_progress - real_progress) > 20 THEN 'critical_drift'
    WHEN abs(stored_progress - real_progress) > 10 THEN 'moderate_drift'
    ELSE 'aligned'
  END AS drift_severity
FROM computed;
