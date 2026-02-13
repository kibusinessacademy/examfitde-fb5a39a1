
CREATE OR REPLACE VIEW public.ops_content_factory AS
WITH pkg_data AS (
  SELECT
    cp.id AS package_id,
    cp.title,
    cp.status,
    (cp.integrity_report->>'score')::int AS integrity_score,
    cp.integrity_passed,
    c.curriculum_id
  FROM course_packages cp
  JOIN courses c ON c.id = cp.course_id
  WHERE cp.status NOT IN ('planning','cancelled')
),
exam_counts AS (
  SELECT p.package_id, COUNT(eq.id) AS exam_count
  FROM pkg_data p
  LEFT JOIN exam_questions eq ON eq.curriculum_id = p.curriculum_id
  GROUP BY p.package_id
),
oral_counts AS (
  SELECT p.package_id, COUNT(ob.id) AS oral_count
  FROM pkg_data p
  LEFT JOIN oral_exam_blueprints ob ON ob.curriculum_id = p.curriculum_id
  GROUP BY p.package_id
),
handbook_counts AS (
  SELECT
    p.package_id,
    COUNT(DISTINCT hc.id) AS chapter_count,
    COUNT(DISTINCT hs.id) AS section_count
  FROM pkg_data p
  LEFT JOIN handbook_chapters hc ON hc.curriculum_id = p.curriculum_id
  LEFT JOIN handbook_sections hs ON hs.chapter_id = hc.id
  GROUP BY p.package_id
),
tutor_idx AS (
  SELECT DISTINCT ON (package_id)
    package_id,
    created_at AS index_built_at,
    index_version
  FROM ai_tutor_context_index
  ORDER BY package_id, created_at DESC
)
SELECT
  p.package_id,
  p.title,
  p.status,
  p.integrity_score,
  p.integrity_passed,
  COALESCE(ec.exam_count, 0)::int AS exam_count,
  COALESCE(oc.oral_count, 0)::int AS oral_count,
  COALESCE(hc.chapter_count, 0)::int AS handbook_chapters,
  COALESCE(hc.section_count, 0)::int AS handbook_sections,
  ti.index_built_at IS NOT NULL AS tutor_index_exists,
  ti.index_version AS tutor_index_version,
  COALESCE(ec.exam_count, 0) >= 600 AS exam_gate_passed,
  COALESCE(oc.oral_count, 0) >= 20 AS oral_gate_passed,
  COALESCE(hc.chapter_count, 0) >= 5 AS handbook_gate_passed,
  COALESCE(hc.section_count, 0) >= 10 AS sections_gate_passed,
  ti.index_built_at IS NOT NULL AS tutor_gate_passed
FROM pkg_data p
LEFT JOIN exam_counts ec ON ec.package_id = p.package_id
LEFT JOIN oral_counts oc ON oc.package_id = p.package_id
LEFT JOIN handbook_counts hc ON hc.package_id = p.package_id
LEFT JOIN tutor_idx ti ON ti.package_id = p.package_id
ORDER BY p.integrity_score ASC NULLS FIRST;
