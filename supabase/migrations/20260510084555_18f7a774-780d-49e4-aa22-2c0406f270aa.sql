-- Harden admin_get_artifact_completeness: lesson join now goes via
-- curriculum_id → courses → modules → lessons (canonical SSOT path),
-- with package.course_id as fallback. Verified equivalent on sample;
-- defensive against packages where course_id is detached from curriculum.

CREATE OR REPLACE FUNCTION public.admin_get_artifact_completeness(
  p_package_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH pkg AS (
    SELECT cp.id AS package_id, cp.title, cp.status, cp.curriculum_id, cp.course_id,
           cp.feature_flags, cp.build_progress
    FROM course_packages cp
    WHERE cp.id = ANY(p_package_ids)
  ),
  pkg_courses AS (
    -- Canonical path: every course of the package's curriculum,
    -- plus the package's own course_id as fallback.
    SELECT DISTINCT p.package_id, c.id AS course_id
    FROM pkg p
    JOIN courses c ON c.curriculum_id = p.curriculum_id
    UNION
    SELECT p.package_id, p.course_id
    FROM pkg p
    WHERE p.course_id IS NOT NULL
  ),
  les AS (
    SELECT pc.package_id,
      COUNT(l.id) AS lessons_total,
      COUNT(l.id) FILTER (
        WHERE l.content IS NOT NULL
          AND l.content::text <> 'null'
          AND l.content::text NOT LIKE '%_placeholder%'
          AND length(l.content::text) > 500
      ) AS lessons_with_content,
      COUNT(l.id) FILTER (WHERE l.qc_status = 'approved') AS lessons_qc_approved,
      COUNT(l.id) FILTER (WHERE l.minicheck_parsed IS TRUE) AS lessons_with_minicheck
    FROM pkg_courses pc
    LEFT JOIN modules m ON m.course_id = pc.course_id
    LEFT JOIN lessons l ON l.module_id = m.id
    GROUP BY pc.package_id
  ),
  ex AS (
    SELECT p.package_id,
      COUNT(*) FILTER (WHERE eq.status = 'approved'::question_status) AS exam_approved,
      COUNT(*) AS exam_total
    FROM pkg p
    LEFT JOIN exam_questions eq ON eq.curriculum_id = p.curriculum_id
    GROUP BY p.package_id
  ),
  hb AS (
    SELECT p.package_id,
      COUNT(s.id) AS hb_total,
      COUNT(s.id) FILTER (WHERE s.content_markdown IS NOT NULL AND length(s.content_markdown) > 100) AS hb_filled
    FROM pkg p
    LEFT JOIN handbook_chapters hc ON hc.curriculum_id = p.curriculum_id
    LEFT JOIN handbook_sections s ON s.chapter_id = hc.id
    GROUP BY p.package_id
  ),
  steps AS (
    SELECT ps.package_id,
      COUNT(*) AS steps_total,
      COUNT(*) FILTER (WHERE ps.status = 'done'::step_status) AS steps_done,
      jsonb_agg(jsonb_build_object('step_key', ps.step_key, 'status', ps.status)
                ORDER BY ps.step_key)
        FILTER (WHERE ps.status <> 'done'::step_status) AS open_steps
    FROM package_steps ps
    JOIN pkg p ON p.package_id = ps.package_id
    GROUP BY ps.package_id
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'packages', COALESCE(jsonb_agg(jsonb_build_object(
      'package_id', p.package_id,
      'title', p.title,
      'status', p.status,
      'build_progress', p.build_progress,
      'lessons', jsonb_build_object(
        'total', COALESCE(les.lessons_total, 0),
        'with_content', COALESCE(les.lessons_with_content, 0),
        'qc_approved', COALESCE(les.lessons_qc_approved, 0),
        'with_minicheck', COALESCE(les.lessons_with_minicheck, 0),
        'missing_content', GREATEST(COALESCE(les.lessons_total,0) - COALESCE(les.lessons_with_content,0), 0),
        'missing_qc', GREATEST(COALESCE(les.lessons_with_content,0) - COALESCE(les.lessons_qc_approved,0), 0),
        'missing_minicheck', GREATEST(COALESCE(les.lessons_with_content,0) - COALESCE(les.lessons_with_minicheck,0), 0)
      ),
      'exam', jsonb_build_object(
        'approved', COALESCE(ex.exam_approved, 0),
        'total', COALESCE(ex.exam_total, 0),
        'target', 500,
        'missing', GREATEST(500 - COALESCE(ex.exam_approved,0), 0)
      ),
      'handbook', jsonb_build_object(
        'sections_total', COALESCE(hb.hb_total, 0),
        'sections_filled', COALESCE(hb.hb_filled, 0),
        'missing', GREATEST(COALESCE(hb.hb_total,0) - COALESCE(hb.hb_filled,0), 0)
      ),
      'steps', jsonb_build_object(
        'total', COALESCE(steps.steps_total, 0),
        'done', COALESCE(steps.steps_done, 0),
        'open', COALESCE(steps.open_steps, '[]'::jsonb)
      ),
      'gaps', (
        SELECT COALESCE(jsonb_agg(g), '[]'::jsonb) FROM (
          SELECT 'lessons_missing_content' AS gap, GREATEST(COALESCE(les.lessons_total,0) - COALESCE(les.lessons_with_content,0), 0) AS count
          WHERE GREATEST(COALESCE(les.lessons_total,0) - COALESCE(les.lessons_with_content,0), 0) > 0
          UNION ALL
          SELECT 'lessons_missing_qc', GREATEST(COALESCE(les.lessons_with_content,0) - COALESCE(les.lessons_qc_approved,0), 0)
          WHERE GREATEST(COALESCE(les.lessons_with_content,0) - COALESCE(les.lessons_qc_approved,0), 0) > 0
          UNION ALL
          SELECT 'lessons_missing_minicheck', GREATEST(COALESCE(les.lessons_with_content,0) - COALESCE(les.lessons_with_minicheck,0), 0)
          WHERE GREATEST(COALESCE(les.lessons_with_content,0) - COALESCE(les.lessons_with_minicheck,0), 0) > 0
          UNION ALL
          SELECT 'exam_below_target', GREATEST(500 - COALESCE(ex.exam_approved,0), 0)
          WHERE GREATEST(500 - COALESCE(ex.exam_approved,0), 0) > 0
          UNION ALL
          SELECT 'handbook_empty_sections', GREATEST(COALESCE(hb.hb_total,0) - COALESCE(hb.hb_filled,0), 0)
          WHERE GREATEST(COALESCE(hb.hb_total,0) - COALESCE(hb.hb_filled,0), 0) > 0
          UNION ALL
          SELECT 'open_steps', COALESCE(jsonb_array_length(steps.open_steps), 0)
          WHERE COALESCE(jsonb_array_length(steps.open_steps), 0) > 0
        ) g
      )
    )), '[]'::jsonb)
  )
  INTO v
  FROM pkg p
  LEFT JOIN les ON les.package_id = p.package_id
  LEFT JOIN ex ON ex.package_id = p.package_id
  LEFT JOIN hb ON hb.package_id = p.package_id
  LEFT JOIN steps ON steps.package_id = p.package_id;

  RETURN COALESCE(v, jsonb_build_object('packages', '[]'::jsonb, 'generated_at', now()));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_artifact_completeness(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_artifact_completeness(uuid[]) TO authenticated;