
-- ============================================================
-- VIEW 1: ops_package_content_depth
-- ============================================================
CREATE OR REPLACE VIEW ops_package_content_depth AS
WITH pkg_lessons AS (
  SELECT 
    cp.id AS package_id, cp.title AS package_title, cp.status, cp.priority,
    cp.curriculum_id, cp.course_id, l.id AS lesson_id, l.content, l.qc_status,
    l.minicheck_parsed, l.competency_id, l.step,
    CASE WHEN l.content IS NOT NULL AND l.content::text <> 'null' 
      AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500 
      THEN true ELSE false END AS is_real,
    length(l.content::text) AS content_length
  FROM course_packages cp
  JOIN courses c ON cp.course_id = c.id
  JOIN modules m ON m.course_id = c.id
  JOIN lessons l ON l.module_id = m.id
  WHERE cp.archived IS NOT TRUE
)
SELECT 
  package_id, package_title, status, priority, curriculum_id,
  count(*) AS total_lessons,
  count(*) FILTER (WHERE is_real) AS real_lessons,
  count(*) FILTER (WHERE NOT is_real) AS placeholder_lessons,
  CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE is_real) / count(*), 1) ELSE 0 END AS materialization_pct,
  round(avg(content_length) FILTER (WHERE is_real), 0) AS avg_content_chars,
  min(content_length) FILTER (WHERE is_real) AS min_content_chars,
  max(content_length) FILTER (WHERE is_real) AS max_content_chars,
  count(DISTINCT step) FILTER (WHERE is_real AND competency_id IS NOT NULL) AS distinct_steps_with_content,
  count(DISTINCT competency_id) FILTER (WHERE is_real) AS competencies_with_content,
  count(DISTINCT competency_id) AS total_competencies,
  count(*) FILTER (WHERE is_real AND content::text ~* '(Prüfungsfalle|typische Falle|häufiger Fehler|Achtung:)') AS has_exam_traps,
  count(*) FILTER (WHERE is_real AND content::text ~* '(Praxis|Beispiel|Fallbeispiel|Situation)') AS has_practical_examples,
  count(*) FILTER (WHERE is_real AND content_length > 5000) AS elite_depth_lessons
FROM pkg_lessons
GROUP BY package_id, package_title, status, priority, curriculum_id;

-- ============================================================
-- VIEW 2: ops_package_qc_matrix  
-- ============================================================
CREATE OR REPLACE VIEW ops_package_qc_matrix AS
SELECT 
  cp.id AS package_id, cp.title AS package_title, cp.status, cp.priority,
  count(l.id) AS lessons_total,
  count(l.id) FILTER (WHERE l.qc_status = 'approved') AS lessons_qc_approved,
  count(l.id) FILTER (WHERE l.qc_status = 'tier1_passed') AS lessons_qc_tier1,
  count(l.id) FILTER (WHERE l.qc_status = 'tier1_failed') AS lessons_qc_failed,
  count(l.id) FILTER (WHERE l.qc_status IS NULL) AS lessons_qc_pending,
  count(l.id) FILTER (WHERE l.minicheck_parsed = true) AS minichecks_parsed,
  count(l.id) FILTER (WHERE l.minicheck_parsed IS NOT TRUE) AS minichecks_missing,
  (SELECT count(*) FROM minicheck_questions mq 
   JOIN lessons l2 ON l2.id = mq.lesson_id 
   JOIN modules m2 ON m2.id = l2.module_id 
   WHERE m2.course_id = c.id) AS minicheck_questions_total,
  (SELECT count(*) FROM exam_questions eq 
   WHERE eq.curriculum_id = cp.curriculum_id 
   AND eq.status = 'approved'::question_status) AS exam_approved,
  (SELECT count(*) FROM exam_questions eq 
   WHERE eq.curriculum_id = cp.curriculum_id 
   AND eq.status = 'draft'::question_status) AS exam_draft,
  (SELECT count(*) FROM exam_questions eq 
   WHERE eq.curriculum_id = cp.curriculum_id 
   AND eq.status = 'review'::question_status) AS exam_review,
  (SELECT count(*) FROM exam_questions eq 
   WHERE eq.curriculum_id = cp.curriculum_id 
   AND eq.status = 'rejected'::question_status) AS exam_rejected,
  (SELECT count(*) FROM handbook_chapters hc 
   WHERE hc.curriculum_id = cp.curriculum_id) AS handbook_chapters,
  (SELECT count(*) FROM handbook_sections hs 
   JOIN handbook_chapters hc ON hc.id = hs.chapter_id 
   WHERE hc.curriculum_id = cp.curriculum_id 
   AND hs.content_markdown IS NOT NULL AND length(hs.content_markdown) > 100) AS handbook_sections_real,
  (SELECT count(*) FROM content_versions cv
   JOIN lessons l3 ON l3.id = cv.lesson_id
   JOIN modules m3 ON m3.id = l3.module_id
   WHERE m3.course_id = c.id AND cv.status = 'approved') AS cv_approved
FROM course_packages cp
JOIN courses c ON cp.course_id = c.id
JOIN modules m ON m.course_id = c.id
JOIN lessons l ON l.module_id = m.id
WHERE cp.archived IS NOT TRUE
GROUP BY cp.id, cp.title, cp.status, cp.priority, cp.curriculum_id, c.id;

-- ============================================================
-- VIEW 3: ops_package_downstream_missing
-- ============================================================
CREATE OR REPLACE VIEW ops_package_downstream_missing AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title, cp.status, cp.priority,
         cp.curriculum_id, cp.course_id, c.id AS cid
  FROM course_packages cp
  JOIN courses c ON cp.course_id = c.id
  WHERE cp.archived IS NOT TRUE AND cp.status IN ('building','queued','blocked','council_review')
),
lesson_counts AS (
  SELECT p.package_id,
    count(l.id) AS total,
    count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null' 
      AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500) AS real_content,
    count(l.id) FILTER (WHERE l.minicheck_parsed = true) AS with_minichecks,
    count(l.id) FILTER (WHERE l.qc_status = 'approved') AS qc_done
  FROM pkg p
  JOIN modules m ON m.course_id = p.cid
  JOIN lessons l ON l.module_id = m.id
  GROUP BY p.package_id
),
exam_counts AS (
  SELECT p.package_id,
    count(*) FILTER (WHERE eq.status = 'approved'::question_status) AS approved
  FROM pkg p
  LEFT JOIN exam_questions eq ON eq.curriculum_id = p.curriculum_id
  GROUP BY p.package_id
),
handbook_counts AS (
  SELECT p.package_id,
    count(DISTINCT hc.id) AS chapters,
    count(hs.id) FILTER (WHERE hs.content_markdown IS NOT NULL AND length(hs.content_markdown) > 100) AS sections_real
  FROM pkg p
  LEFT JOIN handbook_chapters hc ON hc.curriculum_id = p.curriculum_id
  LEFT JOIN handbook_sections hs ON hs.chapter_id = hc.id
  GROUP BY p.package_id
),
step_status AS (
  SELECT ps.package_id,
    jsonb_object_agg(ps.step_key, ps.status) AS step_map
  FROM package_steps ps
  JOIN pkg p ON p.package_id = ps.package_id
  GROUP BY ps.package_id
)
SELECT 
  p.package_id, p.title AS package_title, p.status, p.priority,
  COALESCE(lc.total, 0) AS lessons_total,
  COALESCE(lc.real_content, 0) AS lessons_with_content,
  COALESCE(lc.total, 0) - COALESCE(lc.real_content, 0) AS content_gap,
  COALESCE(lc.real_content, 0) - COALESCE(lc.with_minichecks, 0) AS minicheck_gap,
  COALESCE(lc.real_content, 0) - COALESCE(lc.qc_done, 0) AS qc_gap,
  GREATEST(500 - COALESCE(ec.approved, 0), 0) AS exam_gap,
  COALESCE(ec.approved, 0) AS exam_approved,
  CASE WHEN COALESCE(hc.chapters, 0) = 0 THEN 'missing' 
       WHEN COALESCE(hc.sections_real, 0) = 0 THEN 'empty_chapters'
       ELSE 'partial' END AS handbook_status,
  COALESCE(hc.chapters, 0) AS handbook_chapters,
  COALESCE(hc.sections_real, 0) AS handbook_sections,
  COALESCE(ss.step_map, '{}'::jsonb) AS step_map,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN COALESCE(lc.total, 0) - COALESCE(lc.real_content, 0) > 0 THEN 'content' END,
    CASE WHEN COALESCE(lc.real_content, 0) - COALESCE(lc.with_minichecks, 0) > 5 THEN 'minichecks' END,
    CASE WHEN COALESCE(lc.real_content, 0) - COALESCE(lc.qc_done, 0) > 10 THEN 'qc' END,
    CASE WHEN COALESCE(ec.approved, 0) < 500 THEN 'exam_pool' END,
    CASE WHEN COALESCE(hc.sections_real, 0) = 0 THEN 'handbook' END
  ], NULL) AS missing_artifacts
FROM pkg p
LEFT JOIN lesson_counts lc ON lc.package_id = p.package_id
LEFT JOIN exam_counts ec ON ec.package_id = p.package_id
LEFT JOIN handbook_counts hc ON hc.package_id = p.package_id
LEFT JOIN step_status ss ON ss.package_id = p.package_id;

-- ============================================================
-- VIEW 4: ops_learner_visible_readiness
-- ============================================================
CREATE OR REPLACE VIEW ops_learner_visible_readiness AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title, cp.status, cp.priority,
         cp.curriculum_id, cp.course_id, cp.is_published, c.id AS cid,
         c.title AS course_title
  FROM course_packages cp
  JOIN courses c ON cp.course_id = c.id
  WHERE cp.archived IS NOT TRUE
),
learner_metrics AS (
  SELECT p.package_id,
    count(DISTINCT m.id) AS module_count,
    count(l.id) AS lesson_count,
    count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null' 
      AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500) AS lessons_readable,
    count(l.id) FILTER (WHERE l.minicheck_parsed = true) AS minichecks_usable,
    (SELECT count(*) FROM minicheck_questions mq 
     JOIN lessons l2 ON l2.id = mq.lesson_id 
     JOIN modules m2 ON m2.id = l2.module_id 
     WHERE m2.course_id = p.cid) AS minicheck_questions_count
  FROM pkg p
  JOIN modules m ON m.course_id = p.cid
  JOIN lessons l ON l.module_id = m.id
  GROUP BY p.package_id, p.cid
),
exam_ready AS (
  SELECT p.package_id,
    count(*) FILTER (WHERE eq.status = 'approved'::question_status) AS exam_questions_approved
  FROM pkg p
  LEFT JOIN exam_questions eq ON eq.curriculum_id = p.curriculum_id
  GROUP BY p.package_id
),
handbook_ready AS (
  SELECT p.package_id,
    count(hs.id) FILTER (WHERE hs.content_markdown IS NOT NULL AND length(hs.content_markdown) > 100) AS handbook_sections
  FROM pkg p
  LEFT JOIN handbook_chapters hc ON hc.curriculum_id = p.curriculum_id
  LEFT JOIN handbook_sections hs ON hs.chapter_id = hc.id
  GROUP BY p.package_id
)
SELECT 
  p.package_id, p.title AS package_title, p.course_title, p.status, p.priority, p.is_published,
  COALESCE(lm.module_count, 0) > 0 AS structure_visible,
  COALESCE(lm.lessons_readable, 0) > 0 AS lessons_readable,
  COALESCE(lm.lessons_readable, 0) AS readable_lesson_count,
  COALESCE(lm.lesson_count, 0) AS total_lesson_count,
  CASE WHEN COALESCE(lm.lesson_count, 0) > 0 
    THEN round(100.0 * COALESCE(lm.lessons_readable, 0) / lm.lesson_count, 1) 
    ELSE 0 END AS lesson_coverage_pct,
  COALESCE(lm.minichecks_usable, 0) > 0 AS minichecks_usable,
  COALESCE(lm.minichecks_usable, 0) AS usable_minicheck_count,
  COALESCE(lm.minicheck_questions_count, 0) AS minicheck_questions_available,
  COALESCE(er.exam_questions_approved, 0) >= 100 AS exam_training_usable,
  COALESCE(er.exam_questions_approved, 0) AS exam_questions_count,
  COALESCE(hr.handbook_sections, 0) > 0 AS handbook_available,
  COALESCE(hr.handbook_sections, 0) AS handbook_section_count,
  CASE
    WHEN COALESCE(lm.lessons_readable, 0) = 0 THEN 'not_ready'
    WHEN COALESCE(lm.lessons_readable, 0)::numeric / NULLIF(lm.lesson_count, 0) >= 0.9
         AND COALESCE(lm.minichecks_usable, 0)::numeric / NULLIF(lm.lessons_readable, 0) >= 0.7
         AND COALESCE(er.exam_questions_approved, 0) >= 100
         AND COALESCE(hr.handbook_sections, 0) > 0
    THEN 'fully_ready'
    WHEN COALESCE(lm.lessons_readable, 0)::numeric / NULLIF(lm.lesson_count, 0) >= 0.5
         AND COALESCE(er.exam_questions_approved, 0) >= 50
    THEN 'partially_ready'
    WHEN COALESCE(lm.lessons_readable, 0) >= 10 THEN 'early_access'
    ELSE 'not_ready'
  END AS learner_tier,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN COALESCE(lm.lessons_readable, 0) = 0 THEN 'lessons_empty' END,
    CASE WHEN COALESCE(lm.minichecks_usable, 0) = 0 AND COALESCE(lm.lessons_readable, 0) > 0 THEN 'minichecks_dead_end' END,
    CASE WHEN COALESCE(er.exam_questions_approved, 0) < 20 THEN 'exam_training_dead_end' END,
    CASE WHEN COALESCE(hr.handbook_sections, 0) = 0 THEN 'handbook_dead_end' END
  ], NULL) AS dead_ends
FROM pkg p
LEFT JOIN learner_metrics lm ON lm.package_id = p.package_id
LEFT JOIN exam_ready er ON er.package_id = p.package_id
LEFT JOIN handbook_ready hr ON hr.package_id = p.package_id;

-- ============================================================
-- VIEW 5: ops_artifact_build_progress (SSOT build progress)
-- ============================================================
CREATE OR REPLACE VIEW ops_artifact_build_progress AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title, cp.status, cp.priority,
         cp.build_progress AS stored_progress, cp.curriculum_id, 
         cp.course_id, c.id AS cid
  FROM course_packages cp
  JOIN courses c ON cp.course_id = c.id
  WHERE cp.archived IS NOT TRUE
),
metrics AS (
  SELECT p.package_id,
    CASE WHEN count(DISTINCT m.id) > 0 AND count(l.id) > 0 THEN 100 ELSE 0 END AS structure_score,
    CASE WHEN count(l.id) > 0 
      THEN round(100.0 * count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null' 
        AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500) / count(l.id), 1) 
      ELSE 0 END AS content_score,
    CASE WHEN count(l.id) FILTER (WHERE l.content IS NOT NULL AND length(l.content::text) > 500) > 0 
      THEN round(100.0 * count(l.id) FILTER (WHERE l.qc_status = 'approved') / 
        NULLIF(count(l.id) FILTER (WHERE l.content IS NOT NULL AND length(l.content::text) > 500), 0), 1)
      ELSE 0 END AS qc_score,
    CASE WHEN count(l.id) FILTER (WHERE l.content IS NOT NULL AND length(l.content::text) > 500) > 0 
      THEN round(100.0 * count(l.id) FILTER (WHERE l.minicheck_parsed = true) / 
        NULLIF(count(l.id) FILTER (WHERE l.content IS NOT NULL AND length(l.content::text) > 500), 0), 1)
      ELSE 0 END AS minicheck_score
  FROM pkg p
  JOIN modules m ON m.course_id = p.cid
  JOIN lessons l ON l.module_id = m.id
  GROUP BY p.package_id
),
exam_score AS (
  SELECT p.package_id,
    LEAST(round(100.0 * count(*) FILTER (WHERE eq.status = 'approved'::question_status) / 500.0, 1), 100) AS score
  FROM pkg p
  LEFT JOIN exam_questions eq ON eq.curriculum_id = p.curriculum_id
  GROUP BY p.package_id
),
handbook_score AS (
  SELECT p.package_id,
    CASE WHEN count(hs.id) FILTER (WHERE hs.content_markdown IS NOT NULL AND length(hs.content_markdown) > 100) > 0 
      THEN LEAST(round(100.0 * count(hs.id) FILTER (WHERE hs.content_markdown IS NOT NULL AND length(hs.content_markdown) > 100) / GREATEST(count(hs.id), 1), 1), 100)
      ELSE 0 END AS score
  FROM pkg p
  LEFT JOIN handbook_chapters hc ON hc.curriculum_id = p.curriculum_id
  LEFT JOIN handbook_sections hs ON hs.chapter_id = hc.id
  GROUP BY p.package_id
),
step_completion AS (
  SELECT ps.package_id,
    CASE WHEN count(*) > 0 
      THEN round(100.0 * count(*) FILTER (WHERE ps.status = 'done') / count(*), 1)
      ELSE 0 END AS score
  FROM package_steps ps
  JOIN pkg p ON p.package_id = ps.package_id
  GROUP BY ps.package_id
)
SELECT
  p.package_id, p.title AS package_title, p.status, p.priority,
  p.stored_progress,
  round(
    0.10 * COALESCE(met.structure_score, 0) +
    0.25 * COALESCE(met.content_score, 0) +
    0.15 * COALESCE(met.qc_score, 0) +
    0.10 * COALESCE(met.minicheck_score, 0) +
    0.20 * COALESCE(es.score, 0) +
    0.10 * COALESCE(hs.score, 0) +
    0.10 * COALESCE(sc.score, 0)
  , 1) AS real_progress,
  p.stored_progress - round(
    0.10 * COALESCE(met.structure_score, 0) +
    0.25 * COALESCE(met.content_score, 0) +
    0.15 * COALESCE(met.qc_score, 0) +
    0.10 * COALESCE(met.minicheck_score, 0) +
    0.20 * COALESCE(es.score, 0) +
    0.10 * COALESCE(hs.score, 0) +
    0.10 * COALESCE(sc.score, 0)
  , 1) AS progress_drift,
  COALESCE(met.structure_score, 0) AS structure_pct,
  COALESCE(met.content_score, 0) AS content_pct,
  COALESCE(met.qc_score, 0) AS qc_pct,
  COALESCE(met.minicheck_score, 0) AS minicheck_pct,
  COALESCE(es.score, 0) AS exam_pct,
  COALESCE(hs.score, 0) AS handbook_pct,
  COALESCE(sc.score, 0) AS steps_done_pct,
  CASE 
    WHEN abs(p.stored_progress - round(
      0.10 * COALESCE(met.structure_score, 0) + 0.25 * COALESCE(met.content_score, 0) +
      0.15 * COALESCE(met.qc_score, 0) + 0.10 * COALESCE(met.minicheck_score, 0) +
      0.20 * COALESCE(es.score, 0) + 0.10 * COALESCE(hs.score, 0) + 0.10 * COALESCE(sc.score, 0)
    , 1)) > 20 THEN 'critical_drift'
    WHEN abs(p.stored_progress - round(
      0.10 * COALESCE(met.structure_score, 0) + 0.25 * COALESCE(met.content_score, 0) +
      0.15 * COALESCE(met.qc_score, 0) + 0.10 * COALESCE(met.minicheck_score, 0) +
      0.20 * COALESCE(es.score, 0) + 0.10 * COALESCE(hs.score, 0) + 0.10 * COALESCE(sc.score, 0)
    , 1)) > 10 THEN 'moderate_drift'
    ELSE 'aligned'
  END AS drift_severity
FROM pkg p
LEFT JOIN metrics met ON met.package_id = p.package_id
LEFT JOIN exam_score es ON es.package_id = p.package_id
LEFT JOIN handbook_score hs ON hs.package_id = p.package_id
LEFT JOIN step_completion sc ON sc.package_id = p.package_id;
