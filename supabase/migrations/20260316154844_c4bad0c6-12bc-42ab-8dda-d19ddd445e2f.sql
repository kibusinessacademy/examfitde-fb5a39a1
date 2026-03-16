
-- ============================================================
-- ALL 5 VIEWS - HARDENED V2 - CLEAN SLATE
-- Join: cp.course_id = c.id (schema-verified)
-- Exam: curriculum_id only (no package_id on exam_questions)
-- CV status: content_version_status enum (proposed/under_review/revise/rejected/approved/published)
-- ============================================================

-- VIEW 1: ops_package_content_depth
CREATE VIEW public.ops_package_content_depth AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title AS package_title, cp.status, cp.priority,
         cp.curriculum_id, c.id AS course_id
  FROM course_packages cp JOIN courses c ON cp.course_id = c.id
  WHERE cp.archived IS NOT TRUE
),
pkg_lessons AS (
  SELECT p.package_id, p.package_title, p.status, p.priority, p.curriculum_id,
    l.id AS lesson_id, l.competency_id, l.step, l.generation_status, l.qc_status,
    l.minicheck_parsed, l.created_at, l.content::text AS content_text,
    CASE WHEN l.content IS NOT NULL AND l.content::text <> 'null'
      AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500
      THEN true ELSE false END AS is_real,
    coalesce(length(l.content::text), 0) AS content_length
  FROM pkg p JOIN modules m ON m.course_id = p.course_id JOIN lessons l ON l.module_id = m.id
)
SELECT package_id, package_title, status, priority, curriculum_id,
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
  count(*) FILTER (WHERE is_real AND content_text ~* '(Prüfungsfalle|typische Falle|häufiger Fehler|Achtung:)') AS lessons_with_exam_traps,
  count(*) FILTER (WHERE is_real AND content_text ~* '(Praxis|Beispiel|Fallbeispiel|Situation)') AS lessons_with_practical_examples,
  count(*) FILTER (WHERE is_real AND content_length > 3000) AS deep_content_lessons,
  count(*) FILTER (WHERE is_real AND content_length > 5000) AS elite_depth_lessons,
  count(*) FILTER (WHERE generation_status = 'generated') AS gen_generated,
  count(*) FILTER (WHERE generation_status = 'claimed') AS gen_claimed,
  count(*) FILTER (WHERE coalesce(generation_status, 'pending') = 'pending') AS gen_pending,
  max(created_at) AS last_lesson_created_at
FROM pkg_lessons GROUP BY package_id, package_title, status, priority, curriculum_id;

-- VIEW 2: ops_package_qc_matrix
CREATE VIEW public.ops_package_qc_matrix AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title AS package_title, cp.status, cp.priority,
         cp.curriculum_id, c.id AS course_id
  FROM course_packages cp JOIN courses c ON cp.course_id = c.id WHERE cp.archived IS NOT TRUE
),
lesson_qc AS (
  SELECT p.package_id,
    count(l.id) AS lessons_total,
    count(l.id) FILTER (WHERE l.qc_status = 'approved') AS lessons_qc_approved,
    count(l.id) FILTER (WHERE l.qc_status = 'tier1_passed') AS lessons_qc_tier1_passed,
    count(l.id) FILTER (WHERE l.qc_status = 'tier1_failed') AS lessons_qc_tier1_failed,
    count(l.id) FILTER (WHERE l.qc_status = 'review') AS lessons_qc_review,
    count(l.id) FILTER (WHERE l.qc_status IS NULL) AS lessons_qc_pending,
    count(l.id) FILTER (WHERE l.minicheck_parsed IS TRUE) AS minichecks_parsed,
    count(l.id) FILTER (WHERE l.minicheck_parsed IS NOT TRUE) AS minichecks_missing
  FROM pkg p JOIN modules m ON m.course_id = p.course_id JOIN lessons l ON l.module_id = m.id
  GROUP BY p.package_id
),
minicheck_counts AS (
  SELECT p.package_id, count(mq.id) AS minicheck_questions_total
  FROM pkg p JOIN modules m ON m.course_id = p.course_id JOIN lessons l ON l.module_id = m.id
  LEFT JOIN minicheck_questions mq ON mq.lesson_id = l.id GROUP BY p.package_id
),
exam_counts AS (
  SELECT p.package_id,
    count(eq.id) FILTER (WHERE eq.status = 'approved'::question_status) AS exam_approved,
    count(eq.id) FILTER (WHERE eq.status = 'draft'::question_status) AS exam_draft,
    count(eq.id) FILTER (WHERE eq.status = 'review'::question_status) AS exam_review,
    count(eq.id) FILTER (WHERE eq.status = 'rejected'::question_status) AS exam_rejected,
    count(eq.id) AS exam_total
  FROM pkg p LEFT JOIN exam_questions eq ON eq.curriculum_id = p.curriculum_id GROUP BY p.package_id
),
handbook_counts AS (
  SELECT p.package_id,
    count(DISTINCT hc.id) AS handbook_chapters,
    count(hs.id) FILTER (WHERE hs.content_markdown IS NOT NULL AND length(hs.content_markdown) > 100) AS handbook_sections_real,
    count(hs.id) AS handbook_sections_total
  FROM pkg p LEFT JOIN handbook_chapters hc ON hc.curriculum_id = p.curriculum_id
  LEFT JOIN handbook_sections hs ON hs.chapter_id = hc.id GROUP BY p.package_id
),
cv_counts AS (
  SELECT p.package_id,
    count(cv.id) FILTER (WHERE cv.status = 'approved'::content_version_status) AS cv_approved,
    count(cv.id) FILTER (WHERE cv.status = 'under_review'::content_version_status) AS cv_under_review,
    count(cv.id) AS cv_total
  FROM pkg p JOIN modules m ON m.course_id = p.course_id JOIN lessons l ON l.module_id = m.id
  LEFT JOIN content_versions cv ON cv.lesson_id = l.id GROUP BY p.package_id
)
SELECT p.package_id, p.package_title, p.status, p.priority,
  coalesce(lq.lessons_total, 0) AS lessons_total,
  coalesce(lq.lessons_qc_approved, 0) AS lessons_qc_approved,
  coalesce(lq.lessons_qc_tier1_passed, 0) AS lessons_qc_tier1_passed,
  coalesce(lq.lessons_qc_tier1_failed, 0) AS lessons_qc_tier1_failed,
  coalesce(lq.lessons_qc_review, 0) AS lessons_qc_review,
  coalesce(lq.lessons_qc_pending, 0) AS lessons_qc_pending,
  coalesce(lq.minichecks_parsed, 0) AS minichecks_parsed,
  coalesce(lq.minichecks_missing, 0) AS minichecks_missing,
  coalesce(mc.minicheck_questions_total, 0) AS minicheck_questions_total,
  coalesce(ec.exam_approved, 0) AS exam_approved,
  coalesce(ec.exam_draft, 0) AS exam_draft,
  coalesce(ec.exam_review, 0) AS exam_review,
  coalesce(ec.exam_rejected, 0) AS exam_rejected,
  coalesce(ec.exam_total, 0) AS exam_total,
  coalesce(hc.handbook_chapters, 0) AS handbook_chapters,
  coalesce(hc.handbook_sections_real, 0) AS handbook_sections_real,
  coalesce(hc.handbook_sections_total, 0) AS handbook_sections_total,
  coalesce(cvc.cv_approved, 0) AS content_versions_approved,
  coalesce(cvc.cv_under_review, 0) AS content_versions_under_review,
  coalesce(cvc.cv_total, 0) AS content_versions_total
FROM pkg p
LEFT JOIN lesson_qc lq ON lq.package_id = p.package_id
LEFT JOIN minicheck_counts mc ON mc.package_id = p.package_id
LEFT JOIN exam_counts ec ON ec.package_id = p.package_id
LEFT JOIN handbook_counts hc ON hc.package_id = p.package_id
LEFT JOIN cv_counts cvc ON cvc.package_id = p.package_id;

-- VIEW 3: ops_package_downstream_missing
CREATE VIEW public.ops_package_downstream_missing AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title, cp.status, cp.priority, cp.curriculum_id, c.id AS course_id
  FROM course_packages cp JOIN courses c ON cp.course_id = c.id
  WHERE cp.archived IS NOT TRUE AND cp.status IN ('building','queued','blocked','council_review')
),
lc AS (
  SELECT p.package_id,
    count(l.id) AS total,
    count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null'
      AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500) AS real_content,
    count(l.id) FILTER (WHERE l.minicheck_parsed IS TRUE) AS with_minichecks,
    count(l.id) FILTER (WHERE l.qc_status = 'approved') AS qc_done
  FROM pkg p JOIN modules m ON m.course_id = p.course_id JOIN lessons l ON l.module_id = m.id
  GROUP BY p.package_id
),
ec AS (
  SELECT p.package_id, count(*) FILTER (WHERE eq.status = 'approved'::question_status) AS approved, count(*) AS total
  FROM pkg p LEFT JOIN exam_questions eq ON eq.curriculum_id = p.curriculum_id GROUP BY p.package_id
),
hc AS (
  SELECT p.package_id, count(DISTINCT hch.id) AS chapters,
    count(hs.id) FILTER (WHERE hs.content_markdown IS NOT NULL AND length(hs.content_markdown) > 100) AS sections_real
  FROM pkg p LEFT JOIN handbook_chapters hch ON hch.curriculum_id = p.curriculum_id
  LEFT JOIN handbook_sections hs ON hs.chapter_id = hch.id GROUP BY p.package_id
),
ss AS (
  SELECT ps.package_id, jsonb_object_agg(ps.step_key, ps.status) AS step_map
  FROM package_steps ps JOIN pkg p ON p.package_id = ps.package_id GROUP BY ps.package_id
)
SELECT p.package_id, p.title AS package_title, p.status, p.priority,
  coalesce(lc.total, 0) AS lessons_total,
  coalesce(lc.real_content, 0) AS lessons_with_content,
  greatest(coalesce(lc.total, 0) - coalesce(lc.real_content, 0), 0) AS content_gap,
  greatest(coalesce(lc.real_content, 0) - coalesce(lc.with_minichecks, 0), 0) AS minicheck_gap,
  greatest(coalesce(lc.real_content, 0) - coalesce(lc.qc_done, 0), 0) AS qc_gap,
  coalesce(ec.approved, 0) AS exam_approved, coalesce(ec.total, 0) AS exam_total,
  greatest(500 - coalesce(ec.approved, 0), 0) AS exam_gap_to_publish_gate,
  coalesce(hc.chapters, 0) AS handbook_chapters, coalesce(hc.sections_real, 0) AS handbook_sections_real,
  CASE WHEN coalesce(hc.chapters, 0) = 0 THEN 'missing'
       WHEN coalesce(hc.sections_real, 0) = 0 THEN 'empty_chapters' ELSE 'present' END AS handbook_status,
  coalesce(ss.step_map, '{}'::jsonb) AS step_map,
  array_remove(array[
    CASE WHEN greatest(coalesce(lc.total, 0) - coalesce(lc.real_content, 0), 0) > 0 THEN 'content' END,
    CASE WHEN greatest(coalesce(lc.real_content, 0) - coalesce(lc.with_minichecks, 0), 0) > 0 THEN 'minichecks' END,
    CASE WHEN greatest(coalesce(lc.real_content, 0) - coalesce(lc.qc_done, 0), 0) > 0 THEN 'qc' END,
    CASE WHEN coalesce(ec.approved, 0) < 500 THEN 'exam_pool' END,
    CASE WHEN coalesce(hc.sections_real, 0) = 0 THEN 'handbook' END
  ], NULL) AS missing_artifacts
FROM pkg p LEFT JOIN lc ON lc.package_id = p.package_id LEFT JOIN ec ON ec.package_id = p.package_id
LEFT JOIN hc ON hc.package_id = p.package_id LEFT JOIN ss ON ss.package_id = p.package_id;

-- VIEW 4: ops_learner_visible_readiness
CREATE VIEW public.ops_learner_visible_readiness AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title AS package_title, cp.status, cp.priority,
         cp.curriculum_id, cp.published_at, cp.is_published, c.id AS course_id, c.title AS course_title
  FROM course_packages cp JOIN courses c ON cp.course_id = c.id WHERE cp.archived IS NOT TRUE
),
lm AS (
  SELECT p.package_id,
    count(DISTINCT m.id) AS module_count, count(l.id) AS lesson_count,
    count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null'
      AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500) AS lessons_readable,
    count(l.id) FILTER (WHERE l.minicheck_parsed IS TRUE) AS minichecks_usable
  FROM pkg p JOIN modules m ON m.course_id = p.course_id JOIN lessons l ON l.module_id = m.id
  GROUP BY p.package_id
),
mc AS (
  SELECT p.package_id, count(mq.id) AS minicheck_questions_available
  FROM pkg p JOIN modules m ON m.course_id = p.course_id JOIN lessons l ON l.module_id = m.id
  LEFT JOIN minicheck_questions mq ON mq.lesson_id = l.id GROUP BY p.package_id
),
er AS (
  SELECT p.package_id, count(eq.id) FILTER (WHERE eq.status = 'approved'::question_status) AS exam_questions_approved
  FROM pkg p LEFT JOIN exam_questions eq ON eq.curriculum_id = p.curriculum_id GROUP BY p.package_id
),
hr AS (
  SELECT p.package_id,
    count(hs.id) FILTER (WHERE hs.content_markdown IS NOT NULL AND length(hs.content_markdown) > 100) AS handbook_sections_available
  FROM pkg p LEFT JOIN handbook_chapters hc ON hc.curriculum_id = p.curriculum_id
  LEFT JOIN handbook_sections hs ON hs.chapter_id = hc.id GROUP BY p.package_id
)
SELECT p.package_id, p.package_title, p.course_title, p.status, p.priority,
  p.is_published, p.published_at,
  (coalesce(lm.module_count, 0) > 0 AND coalesce(lm.lesson_count, 0) > 0) AS structure_visible,
  coalesce(lm.lessons_readable, 0) > 0 AS lessons_readable,
  coalesce(lm.lessons_readable, 0) AS readable_lesson_count,
  coalesce(lm.lesson_count, 0) AS total_lesson_count,
  CASE WHEN coalesce(lm.lesson_count, 0) > 0
    THEN round(100.0 * coalesce(lm.lessons_readable, 0) / lm.lesson_count, 1) ELSE 0 END AS lesson_coverage_pct,
  coalesce(lm.minichecks_usable, 0) > 0 AS minichecks_usable,
  coalesce(lm.minichecks_usable, 0) AS usable_minicheck_count,
  coalesce(mc.minicheck_questions_available, 0) AS minicheck_questions_available,
  coalesce(er.exam_questions_approved, 0) >= 100 AS exam_training_usable,
  coalesce(er.exam_questions_approved, 0) AS exam_questions_count,
  coalesce(hr.handbook_sections_available, 0) > 0 AS handbook_available,
  coalesce(hr.handbook_sections_available, 0) AS handbook_section_count,
  CASE
    WHEN coalesce(lm.lessons_readable, 0) = 0 THEN 'not_ready'
    WHEN coalesce(lm.lessons_readable, 0)::numeric / nullif(lm.lesson_count, 0) >= 0.9
      AND coalesce(lm.minichecks_usable, 0)::numeric / nullif(lm.lessons_readable, 0) >= 0.7
      AND coalesce(er.exam_questions_approved, 0) >= 100
      AND coalesce(hr.handbook_sections_available, 0) > 0 THEN 'fully_ready'
    WHEN coalesce(lm.lessons_readable, 0)::numeric / nullif(lm.lesson_count, 0) >= 0.5
      AND coalesce(er.exam_questions_approved, 0) >= 50 THEN 'partially_ready'
    WHEN coalesce(lm.lessons_readable, 0) >= 10 THEN 'early_access'
    ELSE 'not_ready'
  END AS learner_tier,
  array_remove(array[
    CASE WHEN coalesce(lm.lessons_readable, 0) = 0 THEN 'lessons_empty' END,
    CASE WHEN coalesce(lm.minichecks_usable, 0) = 0 AND coalesce(lm.lessons_readable, 0) > 0 THEN 'minichecks_dead_end' END,
    CASE WHEN coalesce(er.exam_questions_approved, 0) < 20 THEN 'exam_training_dead_end' END,
    CASE WHEN coalesce(hr.handbook_sections_available, 0) = 0 THEN 'handbook_dead_end' END
  ], NULL) AS dead_ends
FROM pkg p LEFT JOIN lm ON lm.package_id = p.package_id LEFT JOIN mc ON mc.package_id = p.package_id
LEFT JOIN er ON er.package_id = p.package_id LEFT JOIN hr ON hr.package_id = p.package_id;

-- VIEW 5: ops_artifact_build_progress
CREATE VIEW public.ops_artifact_build_progress AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title, cp.status, cp.priority,
         cp.build_progress AS stored_progress, cp.curriculum_id, c.id AS course_id
  FROM course_packages cp JOIN courses c ON cp.course_id = c.id WHERE cp.archived IS NOT TRUE
),
met AS (
  SELECT p.package_id,
    CASE WHEN count(DISTINCT m.id) > 0 AND count(l.id) > 0 THEN 100 ELSE 0 END AS structure_score,
    CASE WHEN count(l.id) > 0 THEN round(100.0 * count(l.id) FILTER (WHERE l.content IS NOT NULL
      AND l.content::text <> 'null' AND l.content::text NOT LIKE '%_placeholder%'
      AND length(l.content::text) > 500) / count(l.id), 1) ELSE 0 END AS content_score,
    CASE WHEN count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null'
      AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500) > 0
      THEN round(100.0 * count(l.id) FILTER (WHERE l.qc_status = 'approved') /
        nullif(count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null'
        AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500), 0), 1)
      ELSE 0 END AS qc_score,
    CASE WHEN count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null'
      AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500) > 0
      THEN round(100.0 * count(l.id) FILTER (WHERE l.minicheck_parsed IS TRUE) /
        nullif(count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null'
        AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500), 0), 1)
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
    CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE ps.status = 'done') / count(*), 1) ELSE 0 END AS score
  FROM package_steps ps JOIN pkg p ON p.package_id = ps.package_id GROUP BY ps.package_id
)
SELECT p.package_id, p.title AS package_title, p.status, p.priority, p.stored_progress,
  round(0.10 * coalesce(met.structure_score, 0) + 0.25 * coalesce(met.content_score, 0) +
    0.15 * coalesce(met.qc_score, 0) + 0.10 * coalesce(met.minicheck_score, 0) +
    0.20 * coalesce(es.score, 0) + 0.10 * coalesce(hs.score, 0) + 0.10 * coalesce(sc.score, 0), 1) AS real_progress,
  p.stored_progress - round(0.10 * coalesce(met.structure_score, 0) + 0.25 * coalesce(met.content_score, 0) +
    0.15 * coalesce(met.qc_score, 0) + 0.10 * coalesce(met.minicheck_score, 0) +
    0.20 * coalesce(es.score, 0) + 0.10 * coalesce(hs.score, 0) + 0.10 * coalesce(sc.score, 0), 1) AS progress_drift,
  coalesce(met.structure_score, 0) AS structure_pct,
  coalesce(met.content_score, 0) AS content_pct,
  coalesce(met.qc_score, 0) AS qc_pct,
  coalesce(met.minicheck_score, 0) AS minicheck_pct,
  coalesce(es.score, 0) AS exam_pct,
  coalesce(hs.score, 0) AS handbook_pct,
  coalesce(sc.score, 0) AS steps_done_pct,
  CASE
    WHEN abs(p.stored_progress - round(0.10 * coalesce(met.structure_score, 0) + 0.25 * coalesce(met.content_score, 0) +
      0.15 * coalesce(met.qc_score, 0) + 0.10 * coalesce(met.minicheck_score, 0) +
      0.20 * coalesce(es.score, 0) + 0.10 * coalesce(hs.score, 0) + 0.10 * coalesce(sc.score, 0), 1)) > 20
    THEN 'critical_drift'
    WHEN abs(p.stored_progress - round(0.10 * coalesce(met.structure_score, 0) + 0.25 * coalesce(met.content_score, 0) +
      0.15 * coalesce(met.qc_score, 0) + 0.10 * coalesce(met.minicheck_score, 0) +
      0.20 * coalesce(es.score, 0) + 0.10 * coalesce(hs.score, 0) + 0.10 * coalesce(sc.score, 0), 1)) > 10
    THEN 'moderate_drift'
    ELSE 'aligned'
  END AS drift_severity
FROM pkg p LEFT JOIN met ON met.package_id = p.package_id LEFT JOIN es ON es.package_id = p.package_id
LEFT JOIN hs ON hs.package_id = p.package_id LEFT JOIN sc ON sc.package_id = p.package_id;
